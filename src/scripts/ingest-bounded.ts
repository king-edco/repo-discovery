import { Octokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos, type NewRepo } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { upsertRepoVector } from "@/lib/vector-db";
import { upsertRepoFts } from "@/lib/fts";

const README_MAX_CHARS = 3000;
const EMBED_README_CHARS = 500;
const README_CONCURRENCY = 8;

type Strategy = { label: string; q: string };

// Bounded set of diverse topics — one search query each, capped at 1 page (100
// repos). ~20 topics x ~100 = ~2000 candidates, but many overlap. After dedup
// expect ~300-600 unique repos. README fetch + embed is the real cost.
const BOUNDED_TOPICS: string[] = [
  "react", "python", "rust", "machine-learning", "game",
  "video", "cli", "database", "docker", "security",
  "finance", "music", "graphics", "android", "ios",
  "api", "typescript", "go", "blockchain", "terminal",
];

function buildOctokit(token: string): Octokit {
  const log = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.includes("/readme - 404")) return;
      console.warn(...args);
    },
    error: (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.includes("/readme - 404")) return;
      console.error(...args);
    },
  };
  const MyOctokit = Octokit.plugin(paginateRest, throttling).defaults({
    log,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`[throttle] rate limit on ${options.method} ${options.url}. Retrying after ${retryAfter}s (attempt ${retryCount + 1}).`);
        return retryCount < 3;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`[throttle] secondary rate limit on ${options.method} ${options.url}. Retrying after ${retryAfter}s (attempt ${retryCount + 1}).`);
        return retryCount < 2;
      },
    },
  });
  return new MyOctokit({ auth: token });
}

type SearchRepoItem = Awaited<ReturnType<Octokit["rest"]["search"]["repos"]>>["data"]["items"][number];

function toNewRepo(item: SearchRepoItem, readmeText: string | null): NewRepo {
  return {
    id: String(item.id),
    name: item.name,
    full_name: item.full_name,
    description: item.description ?? null,
    url: item.html_url,
    stars: item.stargazers_count ?? 0,
    language: item.language ?? null,
    license: item.license?.spdx_id ?? null,
    readme_text: readmeText,
    topics: JSON.stringify(item.topics ?? []),
    pushed_at: item.pushed_at ?? new Date().toISOString(),
    ingested_at: new Date().toISOString(),
  };
}

async function fetchReadme(octokit: Octokit, owner: string, repo: string): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getReadme({ owner, repo });
    return Buffer.from(data.content, "base64").toString("utf-8").slice(0, README_MAX_CHARS);
  } catch {
    return null;
  }
}

async function searchQuery(octokit: Octokit, q: string): Promise<SearchRepoItem[]> {
  const items: SearchRepoItem[] = [];
  for await (const response of octokit.paginate.iterator(octokit.rest.search.repos, {
    q, sort: "stars", order: "desc", per_page: 50,
  })) {
    items.push(...response.data);
    if (items.length >= 100) break; // cap at 1 page per topic
  }
  return items;
}

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error("GITHUB_TOKEN not set"); process.exit(1); }
  const octokit = buildOctokit(token);
  const db = getDb();

  const before = db.select({ c: sql<number>`count(*)` }).from(repos).get();
  console.log(`[start] ${before?.c ?? 0} repos in DB`);

  console.log("[embed] loading model...");
  const embedder = await getEmbedder();
  console.log("[embed] model loaded");

  const strategies: Strategy[] = BOUNDED_TOPICS.map((t) => ({
    label: `topic:${t}`,
    q: `topic:${t} stars:>100 is:public`,
  }));

  let totalUpdated = 0;
  const runStart = Date.now();

  for (const strategy of strategies) {
    try {
      console.log(`\n[strategy] ${strategy.label} — "${strategy.q}"`);
      const items = await searchQuery(octokit, strategy.q);
      console.log(`[strategy] ${strategy.label}: found ${items.length} repos`);
      if (items.length === 0) continue;

      const seen = new Set<string>();
      const unique = items.filter((it) => { const id = String(it.id); if (seen.has(id)) return false; seen.add(id); return true; });

      let processed = 0;
      await mapPool(unique, README_CONCURRENCY, async (item) => {
        const [owner, name] = item.full_name.split("/");
        const readme = await fetchReadme(octokit, owner, name);
        const desc = item.description ?? "";
        const readmeSnippet = readme ? readme.slice(0, EMBED_README_CHARS) : "";
        const embedText = `${desc}\n${readmeSnippet}`.trim();
        const vec = embedText ? await embedder.embedPassage(embedText) : null;
        const embeddingJson = vec && vec.length > 0 ? JSON.stringify(vec) : null;

        const repo = toNewRepo(item, readme);
        db.insert(repos).values({ ...repo, embedding: embeddingJson })
          .onConflictDoUpdate({
            target: repos.id,
            set: {
              name: repo.name, full_name: repo.full_name, description: repo.description,
              url: repo.url, stars: repo.stars, language: repo.language, license: repo.license,
              readme_text: repo.readme_text, embedding: embeddingJson, topics: repo.topics,
              pushed_at: repo.pushed_at, ingested_at: repo.ingested_at,
            },
          }).run();

        if (embeddingJson) {
          const v = JSON.parse(embeddingJson) as number[];
          upsertRepoVector(repo.id, v);
        }
        upsertRepoFts(repo.id, repo.full_name, repo.description, repo.readme_text);

        processed++;
        if (processed % 25 === 0) {
          const elapsed = Math.round((Date.now() - runStart) / 1000);
          console.log(`  [strategy] ${strategy.label}: ${processed}/${unique.length} (${elapsed}s)`);
        }
      });

      totalUpdated += unique.length;
      const total = db.select({ c: sql<number>`count(*)` }).from(repos).get();
      const elapsed = Math.round((Date.now() - runStart) / 1000);
      console.log(`[progress] ${strategy.label} done — DB now ${total?.c} repos (${elapsed}s elapsed)`);
    } catch (err) {
      console.error(`[strategy] ${strategy.label} failed, skipping:`, err);
    }
  }

  const after = db.select({ c: sql<number>`count(*)` }).from(repos).get();
  const totalElapsed = Math.round((Date.now() - runStart) / 1000);
  console.log(`\n[done] processed ${totalUpdated} repos, DB now has ${after?.c} repos, ${totalElapsed}s elapsed`);
}

main().catch((err) => { console.error("[fatal]", err); process.exit(1); });
