import { Octokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos, type NewRepo } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";

const MAX_REPOS = 200;
const MIN_STARS = 100;
const README_MAX_CHARS = 3000;
const EMBED_README_CHARS = 500;

// Stop ingesting when this many core-requests are left.
const RATE_LIMIT_FLOOR = 5;

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "GITHUB_TOKEN is not set. Copy .env.example to .env.local and add your token.",
    );
    process.exit(1);
  }
  return token;
}

function buildOctokit(token: string): Octokit {
  const MyOctokit = Octokit.plugin(paginateRest, throttling).defaults({
    throttle: {
      // The Search API allows 30 req/min; the core API allows 5000/hr.
      // onRateLimit / onSecondaryRateLimit back off automatically.
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        const route = options.method + " " + options.url;
        octokit.log.warn(
          `[throttle] rate limit hit on ${route}. Retrying after ${retryAfter}s (attempt ${retryCount + 1}).`,
        );
        if (retryCount < 2) return true;
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        const route = options.method + " " + options.url;
        octokit.log.warn(
          `[throttle] secondary rate limit on ${route}. Retrying after ${retryAfter}s (attempt ${retryCount + 1}).`,
        );
        if (retryCount < 2) return true;
        return false;
      },
    },
  });
  return new MyOctokit({ auth: token });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkRateLimit(
  octokit: Octokit,
  label: string,
): Promise<void> {
  const { data } = await octokit.rest.rateLimit.get();
  const remaining = data.rate.remaining;
  const reset = new Date(data.rate.reset * 1000);
  if (remaining <= RATE_LIMIT_FLOOR) {
    const waitMs = Math.max(reset.getTime() - Date.now(), 1000);
    console.warn(
      `[rate-limit] ${label}: only ${remaining} requests left, reset at ${reset.toISOString()}. Sleeping ${Math.round(waitMs / 1000)}s...`,
    );
    await sleep(waitMs);
  } else if (remaining <= 50) {
    console.warn(`[rate-limit] ${label}: ${remaining} requests remaining.`);
  }
}

type SearchRepoItem = Awaited<
  ReturnType<Octokit["rest"]["search"]["repos"]>
>["data"]["items"][number];

function toNewRepo(
  item: SearchRepoItem,
  readmeText: string | null,
  embedding: number[] | null,
): NewRepo {
  const license = item.license?.spdx_id ?? null;
  const topics = item.topics ?? [];
  return {
    id: String(item.id),
    name: item.name,
    full_name: item.full_name,
    description: item.description ?? null,
    url: item.html_url,
    stars: item.stargazers_count ?? 0,
    language: item.language ?? null,
    license,
    readme_text: readmeText,
    embedding: embedding ? JSON.stringify(embedding) : null,
    topics: JSON.stringify(topics),
    pushed_at: item.pushed_at ?? new Date().toISOString(),
    ingested_at: new Date().toISOString(),
  };
}

async function fetchReadme(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
    });
    // The contents API returns base64-encoded content.
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return decoded.slice(0, README_MAX_CHARS);
  } catch {
    // No README, private, 404, etc.
    return null;
  }
}

async function searchRepos(
  octokit: Octokit,
): Promise<SearchRepoItem[]> {
  const query = `stars:>${MIN_STARS} is:public`;
  console.log(`[search] "${query}", sorted by stars desc, limit ${MAX_REPOS}`);

  const items: SearchRepoItem[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.search.repos,
    {
      q: query,
      sort: "stars",
      order: "desc",
      per_page: 100,
    },
  )) {
    items.push(...response.data);
    console.log(`[search] fetched ${items.length}/${MAX_REPOS} so far`);
    if (items.length >= MAX_REPOS) break;
  }
  return items.slice(0, MAX_REPOS);
}

function upsertRepo(db: ReturnType<typeof getDb>, repo: NewRepo): void {
  db.insert(repos)
    .values(repo)
    .onConflictDoUpdate({
      target: repos.id,
      set: {
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        url: repo.url,
        stars: repo.stars,
        language: repo.language,
        license: repo.license,
        readme_text: repo.readme_text,
        embedding: repo.embedding,
        topics: repo.topics,
        pushed_at: repo.pushed_at,
        ingested_at: repo.ingested_at,
      },
    })
    .run();
}

function countRepos(db: ReturnType<typeof getDb>): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(repos)
    .get();
  return row?.c ?? 0;
}

async function main(): Promise<void> {
  const token = requireToken();
  const octokit = buildOctokit(token);
  const db = getDb();

  const before = countRepos(db);
  console.log(`[start] ${before} repos currently in DB`);

  console.log("[embed] loading model Xenova/all-MiniLM-L6-v2...");
  const embedder = await getEmbedder();
  console.log("[embed] model loaded");

  await checkRateLimit(octokit, "before search");
  const items = await searchRepos(octokit);
  console.log(`[search] got ${items.length} repos`);

  let inserted = 0;
  let updated = 0;
  let readmeCount = 0;
  let embeddingCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const [owner, name] = item.full_name.split("/");

    if ((i + 1) % 25 === 0) {
      await checkRateLimit(octokit, `before repo ${i + 1}/${items.length}`);
    }

    const readme = await fetchReadme(octokit, owner, name);
    if (readme) readmeCount++;

    // Build the text to embed: description + first 500 chars of the README.
    const desc = item.description ?? "";
    const readmeSnippet = readme ? readme.slice(0, EMBED_README_CHARS) : "";
    const embedText = `${desc}\n${readmeSnippet}`.trim();
    const embedding = embedText ? await embedder.embed(embedText) : null;
    if (embedding && embedding.length > 0) embeddingCount++;

    const existed = db.select().from(repos).where(eq(repos.id, String(item.id))).get();
    upsertRepo(db, toNewRepo(item, readme, embedding));
    if (existed) updated++;
    else inserted++;

    if ((i + 1) % 20 === 0) {
      console.log(
        `[ingest] ${i + 1}/${items.length} processed (readmes: ${readmeCount}, embeddings: ${embeddingCount})`,
      );
    }
  }

  const after = countRepos(db);
  console.log(
    `[done] inserted=${inserted} updated=${updated} readme-filled=${readmeCount}/${items.length} embedding-filled=${embeddingCount}/${items.length}`,
  );
  console.log(`[done] DB now has ${after} repos (was ${before})`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
