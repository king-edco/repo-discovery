import { getSqlite } from "@/db";
import { TOPICS } from "@/lib/topics";
import { interestHistogram } from "@/lib/recommendation";
import { buildOctokit, searchReposPage, ingestOne, countRepos, evictToCap } from "@/lib/ingest-core";

// Internal scheduler: a self-driving, interest-targeted ingestion loop that
// runs inside the app process (no external cron needed on single-instance
// deploys). Set SCHEDULER_ENABLED=false to disable (e.g. on every instance but
// one in a multi-instance deployment).
//
// Each tick:
//   1. BOOTSTRAP: if the corpus is empty/small, sweep the top topics across all
//      domains so every interest has something on the shelf from day one.
//   2. EXPLOIT (~80%): ingest from topics proportional to the user interest
//      histogram — the more users want a topic, the deeper/more often we fetch.
//   3. EXPLORE (~20%): ingest a few random topics from the full list so users
//      discover things outside their declared perimeter.
//   4. EVICT: keep the corpus under CORPUS_CAP by dropping the lowest-value
//      (never-engaged, low-star, stale) repos.
//
// GitHub Search caps at 1000 results/query and ~30 search req/min, so ticks use
// small batches (a few topics × one 100-result page each) and pace requests.
// Progress (per-topic page depth) persists in the DB so restarts resume where
// they left off rather than re-fetching page 1 forever.

const TICK_MS = 30 * 60 * 1000; // 30 min between ticks
const BOOTSTRAP_CORPUS_MIN = 500; // run bootstrap while below this
const BOOTSTRAP_TOPICS_PER_TICK = 6;
const EXPLOIT_TOPICS_PER_TICK = 4;
const EXPLORE_TOPICS_PER_TICK = 2;
const CORPUS_CAP = Number(process.env.CORPUS_CAP ?? 50_000);
const MIN_STARS = 50;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function now(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[scheduler ${now()}] ${msg}`);
}

// Per-topic page depth persisted in the DB (survives restarts), so each tick
// pages deeper instead of re-fetching page 1. Uses the raw better-sqlite3
// handle for this tiny KV table.
function getTopicPage(topic: string): number {
  const row = getSqlite()
    .prepare("SELECT page FROM ingest_topic_state WHERE topic = ?")
    .get(topic) as { page: number } | undefined;
  return row?.page ?? 1;
}

function setTopicPage(topic: string, page: number): void {
  getSqlite()
    .prepare("INSERT INTO ingest_topic_state (topic, page) VALUES (?, ?) ON CONFLICT(topic) DO UPDATE SET page = ?")
    .run(topic, page, page);
}

export function ensureSchedulerTables(): void {
  getSqlite().exec(
    "CREATE TABLE IF NOT EXISTS ingest_topic_state (topic TEXT PRIMARY KEY, page INTEGER NOT NULL DEFAULT 1)",
  );
}

// Weighted-pick `n` topics from the interest histogram (exploit), falling back
// to the curated TOPICS list when there's no demand signal yet.
function pickExploitTopics(n: number): string[] {
  const hist = interestHistogram();
  const entries = [...hist.entries()].filter(([t]) => TOPICS.includes(t));
  if (entries.length === 0) {
    // No demand yet: exploit the top curated topics evenly.
    return TOPICS.slice(0, n);
  }
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const picked = new Set<string>();
  let guard = 0;
  while (picked.size < n && guard++ < n * 20) {
    let r = Math.random() * total;
    for (const [topic, count] of entries) {
      r -= count;
      if (r <= 0) {
        picked.add(topic);
        break;
      }
    }
  }
  return [...picked];
}

function pickExploreTopics(n: number): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(TOPICS[Math.floor(Math.random() * TOPICS.length)]);
  return [...out];
}

async function ingestTopic(octokit: ReturnType<typeof buildOctokit>, topic: string): Promise<number> {
  const page = getTopicPage(topic);
  if (page > 10) return 0; // GitHub caps search at 1000 results (10×100)
  const q = `topic:${topic} stars:>${MIN_STARS} is:public`;
  try {
    const { items } = await searchReposPage(octokit, q, page);
    let count = 0;
    for (const item of items) {
      await ingestOne(octokit, item);
      count++;
    }
    if (items.length === 100) setTopicPage(topic, page + 1); // deeper next tick
    return count;
  } catch (e) {
    log(`topic ${topic} page ${page} failed: ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      log("no GITHUB_TOKEN — idling");
      return;
    }
    ensureSchedulerTables();
    const octokit = buildOctokit(token);

    const corpus = countRepos();
    let ingested = 0;

    if (corpus < BOOTSTRAP_CORPUS_MIN) {
      // Cold start: sweep broad topics so every interest domain has content.
      const topics = TOPICS.slice(0, BOOTSTRAP_TOPICS_PER_TICK);
      for (const t of topics) ingested += await ingestTopic(octokit, t);
      log(`bootstrap tick: +${ingested} repos (corpus ${corpus} → ${countRepos()})`);
    } else {
      // Steady state: exploit demand + explore randomly.
      const exploit = pickExploitTopics(EXPLOIT_TOPICS_PER_TICK);
      const explore = pickExploreTopics(EXPLORE_TOPICS_PER_TICK);
      for (const t of [...exploit, ...explore]) ingested += await ingestTopic(octokit, t);
      log(`tick: exploit=[${exploit}] explore=[${explore}] +${ingested} repos (corpus ${countRepos()})`);
    }

    const evicted = evictToCap(CORPUS_CAP);
    if (evicted > 0) log(`evicted ${evicted} low-value repos (cap ${CORPUS_CAP})`);
  } catch (e) {
    log(`tick error: ${e instanceof Error ? e.message : e}`);
  } finally {
    ticking = false;
  }
}

/** Start the ingestion scheduler. Safe to call multiple times. */
export function startScheduler(): void {
  if (process.env.SCHEDULER_ENABLED === "false") return;
  if (timer) return;
  log(`starting (tick every ${TICK_MS / 60000}min, corpus cap ${CORPUS_CAP})`);
  // First tick shortly after boot, then on the interval.
  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), TICK_MS);
}
