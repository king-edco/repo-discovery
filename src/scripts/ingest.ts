import { Octokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { inArray, isNotNull, sql } from "drizzle-orm";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import { repos, type NewRepo } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { TOPICS } from "@/lib/topics";

const README_MAX_CHARS = 3000;
const EMBED_README_CHARS = 500;

// GitHub Search API caps each query at 1000 results (10 pages x 100).
const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = 10; // 10 x 100 = 1000 results cap per query

// README fetching via the core API. GitHub's secondary (abuse-detection)
// rate limit trips easily on bursts, so we fetch READMEs sequentially with
// a small inter-request delay rather than concurrently. This is slower but
// keeps multi-thousand-repo runs stable across several minutes.
const README_CONCURRENCY = 1;
const README_FETCH_DELAY_MS = 300;

// Stop and sleep when the core rate budget gets this low.
const RATE_LIMIT_FLOOR = 50;
// Check the rate budget every N processed repos (each check costs 1 request).
const RATE_CHECK_EVERY = 100;

const PROGRESS_PATH = resolve(process.cwd(), "data/ingest-progress.json");

// Star-range slices. Each is a separate search query so we sidestep the
// 1000-results-per-query cap and cover far more repos in aggregate.
const STAR_RANGES: { label: string; q: string }[] = [
  { label: "stars:50..100", q: "stars:50..100 is:public" },
  { label: "stars:100..300", q: "stars:100..300 is:public" },
  { label: "stars:300..1000", q: "stars:300..1000 is:public" },
  { label: "stars:1000..5000", q: "stars:1000..5000 is:public" },
  { label: "stars:5000..20000", q: "stars:5000..20000 is:public" },
  { label: "stars:>20000", q: "stars:>20000 is:public" },
];

type Strategy = { label: string; q: string };

function buildStrategies(): Strategy[] {
  const strategies: Strategy[] = [...STAR_RANGES];
  for (const topic of TOPICS) {
    strategies.push({
      label: `topic:${topic}`,
      q: `topic:${topic} stars:>50 is:public`,
    });
  }
  return strategies;
}

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
        if (retryCount < 3) return true;
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        const route = options.method + " " + options.url;
        // Secondary (abuse) rate limits can recommend very long waits.
        // Cap our patience: retry a few times with the recommended wait,
        // but give up after that so the run can skip ahead and resume later.
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
      `[rate-limit] ${label}: only ${remaining} core requests left, reset at ${reset.toISOString()}. Sleeping ${Math.round(waitMs / 1000)}s...`,
    );
    await sleep(waitMs);
  } else if (remaining <= 200) {
    console.warn(`[rate-limit] ${label}: ${remaining} core requests remaining.`);
  }
}

type SearchRepoItem = Awaited<
  ReturnType<Octokit["rest"]["search"]["repos"]>
>["data"]["items"][number];

function toNewRepo(
  item: SearchRepoItem,
  readmeText: string | null,
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
    const { data } = await octokit.rest.repos.getReadme({ owner, repo });
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return decoded.slice(0, README_MAX_CHARS);
  } catch {
    return null;
  }
}

/** Search a single query, capped at SEARCH_MAX_PAGES pages. */
async function searchQuery(
  octokit: Octokit,
  q: string,
): Promise<SearchRepoItem[]> {
  const items: SearchRepoItem[] = [];
  let pages = 0;
  for await (const response of octokit.paginate.iterator(
    octokit.rest.search.repos,
    { q, sort: "stars", order: "desc", per_page: SEARCH_PER_PAGE },
  )) {
    items.push(...response.data);
    pages++;
    if (pages >= SEARCH_MAX_PAGES) break;
  }
  return items;
}

function upsertRepo(
  db: ReturnType<typeof getDb>,
  repo: NewRepo,
  embeddingJson: string | null,
): void {
  db.insert(repos)
    .values({ ...repo, embedding: embeddingJson })
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
        embedding: embeddingJson,
        topics: repo.topics,
        pushed_at: repo.pushed_at,
        ingested_at: repo.ingested_at,
      },
    })
    .run();
}

function countRepos(db: ReturnType<typeof getDb>): number {
  const row = db.select({ c: sql<number>`count(*)` }).from(repos).get();
  return row?.c ?? 0;
}

function countCompleteRepos(db: ReturnType<typeof getDb>): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(repos)
    .where(isNotNull(repos.embedding))
    .get();
  return row?.c ?? 0;
}

// ---- resumable progress tracking -------------------------------------------

type Progress = { completed: string[] };

function loadProgress(): Progress {
  if (!existsSync(PROGRESS_PATH)) return { completed: [] };
  try {
    return JSON.parse(readFileSync(PROGRESS_PATH, "utf-8")) as Progress;
  } catch {
    return { completed: [] };
  }
}

function saveProgress(progress: Progress): void {
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ---- concurrency pool -------------------------------------------------------

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}

// ---- strategy processing ----------------------------------------------------

type Counters = {
  inserted: number;
  updated: number;
  readmeCount: number;
  embeddingCount: number;
  skipped: number;
  processed: number;
};

async function processStrategy(
  octokit: Octokit,
  db: ReturnType<typeof getDb>,
  embedder: Awaited<ReturnType<typeof getEmbedder>>,
  strategy: Strategy,
  counters: Counters,
): Promise<void> {
  console.log(`\n[strategy] ${strategy.label} — query: "${strategy.q}"`);
  await checkRateLimit(octokit, strategy.label);
  const items = await searchQuery(octokit, strategy.q);
  console.log(`[strategy] ${strategy.label}: found ${items.length} repos`);
  if (items.length === 0) return;

  // Dedupe within this strategy's batch.
  const seen = new Set<string>();
  const unique = items.filter((it) => {
    const id = String(it.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Pre-load existing rows for these IDs in one query so we don't hit the
  // DB once per repo during the hot loop.
  const ids = unique.map((it) => String(it.id));
  console.log(`[strategy] ${strategy.label}: checking ${ids.length} IDs against DB...`);
  const existingRows = db
    .select({ id: repos.id, readme_text: repos.readme_text, embedding: repos.embedding })
    .from(repos)
    .where(inArray(repos.id, ids))
    .all() as { id: string; readme_text: string | null; embedding: string | null }[];
  const existing = new Map(existingRows.map((r) => [r.id, r]));
  console.log(`[strategy] ${strategy.label}: ${existing.size} already in DB, ${ids.length - existing.size} new; fetching READMEs...`);

  type Task = {
    item: SearchRepoItem;
    owner: string;
    name: string;
    needsWork: boolean;
    storedReadme: string | null;
    storedEmbedding: string | null;
  };
  const tasks: Task[] = unique.map((item) => {
    const id = String(item.id);
    const [owner, name] = item.full_name.split("/");
    const row = existing.get(id);
    const complete = !!row && row.readme_text !== null && row.embedding !== null;
    return {
      item,
      owner,
      name,
      needsWork: !complete,
      storedReadme: row?.readme_text ?? null,
      storedEmbedding: row?.embedding ?? null,
    };
  });

  // Fetch READMEs sequentially with a small delay to avoid GitHub's
  // secondary (abuse-detection) rate limit. For complete repos we reuse the
  // stored README and skip the fetch entirely (fast on resume).
  console.log(`[strategy] ${strategy.label}: starting README fetch pool (concurrency=${README_CONCURRENCY}, tasks=${tasks.length})...`);
  let fetchCount = 0;
  const readmes = await mapPool(tasks, README_CONCURRENCY, async (task) => {
    if (!task.needsWork) return task.storedReadme;
    fetchCount++;
    if (fetchCount % 50 === 0) console.log(`[strategy] ${strategy.label}: fetched ${fetchCount}/${tasks.length} READMEs...`);
    const readme = await fetchReadme(octokit, task.owner, task.name);
    await sleep(README_FETCH_DELAY_MS);
    return readme;
  });
  console.log(`[strategy] ${strategy.label}: README fetches done, generating embeddings...`);

  let strategyInserted = 0;
  let strategySkipped = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const readme = readmes[i];
    if (readme) counters.readmeCount++;

    const desc = task.item.description ?? "";
    const readmeSnippet = readme ? readme.slice(0, EMBED_README_CHARS) : "";
    const embedText = `${desc}\n${readmeSnippet}`.trim();

    let embeddingJson: string | null;
    if (task.needsWork) {
      const vec = embedText ? await embedder.embed(embedText) : null;
      embeddingJson = vec && vec.length > 0 ? JSON.stringify(vec) : null;
      if (embeddingJson) counters.embeddingCount++;
    } else {
      // Reuse the stored embedding; only refresh metadata.
      embeddingJson = task.storedEmbedding;
    }

    const existed = existing.has(String(task.item.id));
    upsertRepo(db, toNewRepo(task.item, readme), embeddingJson);

    if (existed && !task.needsWork) {
      counters.updated++;
      counters.skipped++;
      strategySkipped++;
    } else if (existed) {
      counters.updated++;
    } else {
      counters.inserted++;
      strategyInserted++;
    }
    counters.processed++;

    if (counters.processed % RATE_CHECK_EVERY === 0) {
      await checkRateLimit(octokit, `progress (processed ${counters.processed})`);
    }
  }

  console.log(
    `[strategy] ${strategy.label}: ingested ${strategyInserted} new, skipped ${strategySkipped} already-complete`,
  );
}

async function main(): Promise<void> {
  const token = requireToken();
  const octokit = buildOctokit(token);
  const db = getDb();

  const before = countRepos(db);
  const beforeComplete = countCompleteRepos(db);
  console.log(`[start] ${before} repos in DB (${beforeComplete} with embeddings)`);

  console.log("[embed] loading model Xenova/all-MiniLM-L6-v2...");
  const embedder = await getEmbedder();
  console.log("[embed] model loaded");

  const allStrategies = buildStrategies();
  const progress = loadProgress();
  const remaining = allStrategies.filter(
    (s) => !progress.completed.includes(s.label),
  );

  if (progress.completed.length > 0) {
    console.log(
      `[resume] ${progress.completed.length} strategies already done, ${remaining.length} remaining`,
    );
  }
  console.log(
    `[plan] ${remaining.length} strategies (${STAR_RANGES.length} star ranges + ${TOPICS.length} topics)`,
  );

  const counters: Counters = {
    inserted: 0,
    updated: 0,
    readmeCount: 0,
    embeddingCount: 0,
    skipped: 0,
    processed: 0,
  };

  for (const strategy of remaining) {
    try {
      await processStrategy(octokit, db, embedder, strategy, counters);
      progress.completed.push(strategy.label);
      saveProgress(progress);
      const total = countRepos(db);
      const complete = countCompleteRepos(db);
      console.log(
        `[progress] DB now has ${total} repos (${complete} with embeddings). inserted=${counters.inserted} updated=${counters.updated} skipped=${counters.skipped}`,
      );
    } catch (err) {
      // A strategy may fail (e.g. GitHub secondary rate limit exhausted).
      // Save progress and skip to the next strategy so a later restart can
      // retry this one from scratch instead of blocking the whole run.
      console.error(`[strategy] ${strategy.label} failed, skipping:`, err);
      saveProgress(progress);
    }
  }

  const after = countRepos(db);
  const afterComplete = countCompleteRepos(db);
  console.log(
    `\n[done] inserted=${counters.inserted} updated=${counters.updated} skipped=${counters.skipped} readme-filled=${counters.readmeCount} embedding-filled=${counters.embeddingCount}`,
  );
  console.log(
    `[done] DB now has ${after} repos (${afterComplete} with embeddings), was ${before} (${beforeComplete} with embeddings)`,
  );
  console.log(`[done] all ${allStrategies.length} strategies completed`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
