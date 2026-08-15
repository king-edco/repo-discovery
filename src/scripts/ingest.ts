import { Octokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { inArray, isNotNull, sql } from "drizzle-orm";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/db";
import { repos, type NewRepo } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { upsertRepoVector } from "@/lib/vector-db";
import { upsertRepoFts } from "@/lib/fts";
import { TOPICS } from "@/lib/topics";

const README_MAX_CHARS = 3000;
const EMBED_README_CHARS = 500;

// GitHub Search API caps each query at 1000 results (10 pages x 100).
const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = 10; // 10 x 100 = 1000 results cap per query

// README fetching via the core API. We run a bounded pool of concurrent
// requests (concurrency 8) for throughput; the throttling plugin handles
// automatic back-off if GitHub's primary or secondary rate limits bite.
const README_CONCURRENCY = 8;
// Log a progress line every N READMEs fetched within a strategy.
const README_LOG_EVERY = 50;

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

// Broad category keywords used to discover topics dynamically via the
// GitHub Search Topics API (GET /search/topics). One query per category
// keeps discovery diverse and bounded. Each query is paginated up to
// TOPIC_SEARCH_MAX_PAGES pages.
const TOPIC_CATEGORIES: string[] = [
  "dev",
  "language",
  "web",
  "data",
  "media",
  "infra",
  "mobile",
  "system",
  "security",
  "science",
];

// The Search API allows 30 requests/minute when authenticated. We space
// topic-discovery calls by this much (2.5s => ~24 req/min) to stay safely
// under the limit and leave headroom for the ingestion search queries that
// follow. Each topic query is capped at 1000 results (10 pages x 100).
const TOPIC_SEARCH_PER_PAGE = 100;
const TOPIC_SEARCH_MAX_PAGES = 5; // up to 500 candidate topics per category
const TOPIC_SEARCH_INTERVAL_MS = 2500;

function buildStarRangeStrategies(): Strategy[] {
  return STAR_RANGES.map((r) => ({ label: r.label, q: r.q }));
}

function topicToStrategy(topic: string): Strategy {
  return {
    label: `topic:${topic}`,
    q: `topic:${topic} stars:>50 is:public`,
  };
}

function buildStrategiesForTopics(topics: string[]): Strategy[] {
  return topics.map(topicToStrategy);
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
  // Octokit's default logger dumps every request line ("GET /repos/.../readme")
  // plus every non-2xx response to stderr, which drowns out our own progress
  // logs. We silence debug/info entirely and route warn/error through a
  // filter that drops the expected 404-on-README lines (many repos simply have
  // no README file); real rate-limit / 5xx warnings still surface.
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

type TopicItem = { name: string };

/**
 * Fetch one page of the GitHub Search Topics API. The topics endpoint is not
 * part of octokit's typed REST surface, so we call the raw endpoint directly.
 * Each call costs one of the 30 search requests/minute (distinct from the
 * 5000/hr core budget), so callers must space these out.
 */
async function searchTopicsPage(
  octokit: Octokit,
  q: string,
  page: number,
): Promise<{ items: TopicItem[]; total: number }> {
  const response = await octokit.request("GET /search/topics", {
    q,
    per_page: TOPIC_SEARCH_PER_PAGE,
    page,
    headers: { accept: "application/vnd.github+json" },
  });
  const items = (response.data.items ?? []) as TopicItem[];
  return { items, total: response.data.total_count ?? 0 };
}

/**
 * Discover topics beyond the static curated list by querying the GitHub Search
 * Topics API. We first pull every `is:featured` topic (a small, hand-picked
 * set GitHub curates), then sweep one broad keyword per category to surface a
 * large, diverse pool of additional topics. All Search API calls are spaced by
 * TOPIC_SEARCH_INTERVAL_MS to respect the 30 req/min search budget.
 */
async function discoverTopics(octokit: Octokit): Promise<string[]> {
  const found = new Set<string>();

  // 1. Featured topics (the curated set GitHub marks as featured).
  console.log("[topics] fetching featured topics (is:featured)...");
  let featuredCount = 0;
  for (let page = 1; page <= TOPIC_SEARCH_MAX_PAGES; page++) {
    const { items, total } = await searchTopicsPage(octokit, "is:featured", page);
    for (const it of items) {
      if (it.name) {
        found.add(it.name);
        featuredCount++;
      }
    }
    if (page * TOPIC_SEARCH_PER_PAGE >= total) break;
    await sleep(TOPIC_SEARCH_INTERVAL_MS);
  }
  console.log(`[topics] ${featuredCount} featured topics discovered`);

  // 2. Per-category keyword sweep for breadth. `is:featured` alone yields only
  //    a handful of topics, so we also search each broad keyword to surface
  //    hundreds of additional (non-featured) topics covering every domain.
  for (const category of TOPIC_CATEGORIES) {
    let categoryCount = 0;
    let total = 0;
    for (let page = 1; page <= TOPIC_SEARCH_MAX_PAGES; page++) {
      const res = await searchTopicsPage(octokit, category, page);
      total = res.total;
      for (const it of res.items) {
        if (it.name && !found.has(it.name)) {
          found.add(it.name);
          categoryCount++;
        }
      }
      if (page * TOPIC_SEARCH_PER_PAGE >= total) break;
      await sleep(TOPIC_SEARCH_INTERVAL_MS);
    }
    console.log(
      `[topics] category "${category}": +${categoryCount} new (total_count=${total})`,
    );
    await sleep(TOPIC_SEARCH_INTERVAL_MS);
  }

  return [...found];
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

  // Keep the search indexes in sync with the canonical row. The vec0 index
  // needs the parsed vector; the FTS5 index needs the searchable text fields.
  const vec = embeddingJson ? (JSON.parse(embeddingJson) as number[]) : null;
  upsertRepoVector(repo.id, vec);
  upsertRepoFts(repo.id, repo.full_name, repo.description, repo.readme_text);
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
  // DB once per repo during the hot loop. We pull pushed_at so we can tell
  // whether a repo changed since the last ingest and skip re-fetching its
  // README + re-embedding when it hasn't.
  const ids = unique.map((it) => String(it.id));
  const existingRows = db
    .select({
      id: repos.id,
      readme_text: repos.readme_text,
      embedding: repos.embedding,
      pushed_at: repos.pushed_at,
    })
    .from(repos)
    .where(inArray(repos.id, ids))
    .all() as {
    id: string;
    readme_text: string | null;
    embedding: string | null;
    pushed_at: string;
  }[];
  const existing = new Map(existingRows.map((r) => [r.id, r]));

  type Task = {
    item: SearchRepoItem;
    owner: string;
    name: string;
    // True when we must hit the README endpoint: new repo, missing README,
    // or the repo was pushed since we last ingested it.
    needsReadme: boolean;
    // True when we must (re)generate the embedding: README changed, or the
    // embedding is missing for some reason. When false we reuse the stored one.
    needsEmbedding: boolean;
    storedReadme: string | null;
    storedEmbedding: string | null;
  };
  const tasks: Task[] = unique.map((item) => {
    const id = String(item.id);
    const [owner, name] = item.full_name.split("/");
    const row = existing.get(id);
    const hasReadme = !!row && row.readme_text !== null;
    const pushedChanged = !row || row.pushed_at !== (item.pushed_at ?? "");
    const needsReadme = pushedChanged || !hasReadme;
    const needsEmbedding = needsReadme || !row || row.embedding === null;
    return {
      item,
      owner,
      name,
      needsReadme,
      needsEmbedding,
      storedReadme: row?.readme_text ?? null,
      storedEmbedding: row?.embedding ?? null,
    };
  });

  const needsFetchCount = tasks.filter((t) => t.needsReadme).length;
  const reuseCount = tasks.length - needsFetchCount;
  console.log(
    `[strategy] ${strategy.label}: ${tasks.length} repos — ${needsFetchCount} need README fetch, ${reuseCount} reuse cached (pushed_at unchanged)`,
  );

  // Process each repo end-to-end (fetch README -> embed -> upsert) inside the
  // bounded pool. This interleaves writing with fetching so each repo is
  // persisted to the DB as soon as its worker finishes — if the process is
  // interrupted mid-strategy, every repo processed so far is already durable
  // in the SQLite file (WAL + autocommit per upsertRepo call).
  const fetchStart = Date.now();
  let fetched = 0;
  let reuseHit = 0;
  let strategyInserted = 0;
  let strategyRefreshed = 0;

  await mapPool(tasks, README_CONCURRENCY, async (task) => {
    // 1. README — reuse the cached one when pushed_at is unchanged.
    let readme: string | null;
    if (!task.needsReadme) {
      reuseHit++;
      readme = task.storedReadme;
    } else {
      readme = await fetchReadme(octokit, task.owner, task.name);
      fetched++;
      if (fetched % README_LOG_EVERY === 0) {
        const elapsed = Math.round((Date.now() - fetchStart) / 1000);
        const rate = fetched / Math.max(elapsed, 1);
        const remainingFetches = needsFetchCount - fetched;
        const eta = Math.round(remainingFetches / Math.max(rate, 0.01));
        console.log(
          `[strategy] ${strategy.label}: fetched ${fetched}/${needsFetchCount} READMEs (${reuseHit} cache hits) — ${elapsed}s elapsed, ~${eta}s eta`,
        );
      }
    }

    // 2. Embedding — regenerate only when the README changed or it's missing.
    let embeddingJson: string | null;
    if (task.needsEmbedding) {
      const desc = task.item.description ?? "";
      const readmeSnippet = readme ? readme.slice(0, EMBED_README_CHARS) : "";
      const embedText = `${desc}\n${readmeSnippet}`.trim();
      const vec = embedText ? await embedder.embedPassage(embedText) : null;
      embeddingJson = vec && vec.length > 0 ? JSON.stringify(vec) : null;
      if (embeddingJson) counters.embeddingCount++;
    } else {
      embeddingJson = task.storedEmbedding;
    }

    // 3. UPSERT — durable immediately (better-sqlite3 autocommit, WAL).
    const existed = existing.has(String(task.item.id));
    upsertRepo(db, toNewRepo(task.item, readme), embeddingJson);

    // 4. Counters.
    if (readme) counters.readmeCount++;
    if (existed && !task.needsReadme) {
      // Metadata-only refresh: pushed_at unchanged, README + embedding reused.
      counters.updated++;
      counters.skipped++;
      strategyRefreshed++;
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
  });

  const fetchElapsed = Math.round((Date.now() - fetchStart) / 1000);
  console.log(
    `[strategy] ${strategy.label}: done in ${fetchElapsed}s (fetched ${fetched}, reused ${reuseHit}) — ingested ${strategyInserted} new, refreshed ${strategyRefreshed} metadata-only, ${tasks.length - strategyInserted - strategyRefreshed} re-fetched`,
  );
}

async function main(): Promise<void> {
  const token = requireToken();
  const octokit = buildOctokit(token);
  const db = getDb();

  const before = countRepos(db);
  const beforeComplete = countCompleteRepos(db);
  console.log(`[start] ${before} repos in DB (${beforeComplete} with embeddings)`);

  console.log("[embed] loading model Xenova/multilingual-e5-small (q8)...");
  const embedder = await getEmbedder();
  console.log("[embed] model loaded");

  // Build the topic set: the static curated list (guarantees important niches
  // are never forgotten) merged with topics discovered dynamically via the
  // GitHub Search Topics API (is:featured + one broad keyword per category).
  console.log(
    `[topics] static curated list has ${TOPICS.length} topics`,
  );
  const discovered = await discoverTopics(octokit);
  const mergedTopics = [...new Set([...TOPICS, ...discovered])];
  const newTopicCount = mergedTopics.length - TOPICS.length;
  console.log(
    `[topics] discovered ${discovered.length} dynamic topics (+${newTopicCount} new after dedup)`,
  );
  console.log(
    `[topics] total topics after fusion: ${mergedTopics.length} (static ${TOPICS.length} + dynamic ${newTopicCount} new)`,
  );

  const allStrategies = [
    ...buildStarRangeStrategies(),
    ...buildStrategiesForTopics(mergedTopics),
  ];
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
    `[plan] ${remaining.length} strategies (${STAR_RANGES.length} star ranges + ${mergedTopics.length} topics)`,
  );

  const counters: Counters = {
    inserted: 0,
    updated: 0,
    readmeCount: 0,
    embeddingCount: 0,
    skipped: 0,
    processed: 0,
  };

  const runStart = Date.now();
  let strategiesDone = 0;

  for (const strategy of remaining) {
    try {
      await processStrategy(octokit, db, embedder, strategy, counters);
      progress.completed.push(strategy.label);
      saveProgress(progress);
      strategiesDone++;
      const total = countRepos(db);
      const complete = countCompleteRepos(db);
      const elapsed = Math.round((Date.now() - runStart) / 1000);
      const remainingStrategies = remaining.length - strategiesDone;
      const avgPerStrategy = elapsed / strategiesDone;
      const eta = Math.round(avgPerStrategy * remainingStrategies);
      console.log(
        `[progress] ${strategiesDone}/${remaining.length} strategies done — DB ${total} repos (${complete} embed). inserted=${counters.inserted} updated=${counters.updated} metadata-only=${counters.skipped} | ${elapsed}s elapsed, ~${eta}s eta (${remainingStrategies} left)`,
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
  const totalElapsed = Math.round((Date.now() - runStart) / 1000);
  console.log(
    `\n[done] inserted=${counters.inserted} updated=${counters.updated} metadata-only=${counters.skipped} readme-filled=${counters.readmeCount} embedding-filled=${counters.embeddingCount}`,
  );
  console.log(
    `[done] DB now has ${after} repos (${afterComplete} with embeddings), was ${before} (${beforeComplete} with embeddings)`,
  );
  console.log(`[done] all ${allStrategies.length} strategies completed in ${totalElapsed}s`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
