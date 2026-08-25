import { Octokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos, type NewRepo } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { upsertRepoVector, deleteRepoVector } from "@/lib/vector-db";
import { upsertRepoFts, deleteRepoFts } from "@/lib/fts";
import { prewarmOgImage } from "@/lib/og-warm";

// Shared ingestion primitives used by both the CLI scripts (pnpm ingest*) and
// the internal scheduler. Keeping them here means the scheduler reuses exactly
// the same fetch → embed → upsert → index → pre-warm path as the bulk scripts.

const README_MAX_CHARS = 3000;
const EMBED_DESC_CHARS = 500;

export type SearchRepoItem = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count?: number;
  language?: string | null;
  license?: { spdx_id?: string } | null;
  topics?: string[];
  pushed_at?: string | null;
};

export function buildOctokit(token: string): Octokit {
  // Quiet the noisy request logger; surface only real warnings/errors.
  const log = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.includes("/readme - 404")) return; // many repos have no README
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
      // Search API: 30 req/min; core API: 5000/hr. Back off automatically.
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`[throttle] rate limit ${options.method} ${options.url}, retry in ${retryAfter}s`);
        return retryCount < 3;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`[throttle] secondary rate limit ${options.method} ${options.url}, retry in ${retryAfter}s`);
        return retryCount < 2;
      },
    },
  });
  return new MyOctokit({ auth: token });
}

async function fetchReadme(octokit: Octokit, owner: string, repo: string): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getReadme({ owner, repo });
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return decoded.slice(0, README_MAX_CHARS);
  } catch {
    return null;
  }
}

/** Search one query (one page of 100) — a single search API call. */
export async function searchReposPage(
  octokit: Octokit,
  q: string,
  page = 1,
): Promise<{ items: SearchRepoItem[]; total: number }> {
  const { data } = await octokit.rest.search.repos({
    q,
    sort: "stars",
    order: "desc",
    per_page: 100,
    page,
  });
  return { items: data.items as SearchRepoItem[], total: data.total_count };
}

/** Embed a repo's description + README head into the canonical JSON string. */
async function embedRepoText(description: string | null, readme: string | null): Promise<string | null> {
  const text = [description ?? "", (readme ?? "").slice(0, EMBED_DESC_CHARS)]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) return null;
  try {
    const embedder = await getEmbedder();
    const vec = await embedder.embedPassage(text);
    return vec.length > 0 ? JSON.stringify(vec) : null;
  } catch {
    return null;
  }
}

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

/** Upsert one repo: row + embedding + vec0 + FTS5 + OG pre-warm. */
export async function ingestOne(octokit: Octokit, item: SearchRepoItem): Promise<void> {
  const db = getDb();
  const [owner, repoName] = item.full_name.split("/");
  const readme = await fetchReadme(octokit, owner, repoName);
  const row = toNewRepo(item, readme);
  const embeddingJson = await embedRepoText(row.description ?? null, readme);

  db.insert(repos)
    .values({ ...row, embedding: embeddingJson })
    .onConflictDoUpdate({
      target: repos.id,
      set: {
        name: row.name, full_name: row.full_name, description: row.description,
        url: row.url, stars: row.stars, language: row.language, license: row.license,
        readme_text: row.readme_text, embedding: embeddingJson, topics: row.topics,
        pushed_at: row.pushed_at, ingested_at: row.ingested_at,
      },
    })
    .run();

  const vec = embeddingJson ? (JSON.parse(embeddingJson) as number[]) : null;
  upsertRepoVector(row.id, vec);
  upsertRepoFts(row.id, row.full_name, row.description, row.readme_text);
  // Pre-warm the OG preview so the feed never waits on GitHub at render time.
  void prewarmOgImage(row.full_name);
}

export function countRepos(): number {
  const row = getDb().select({ c: sql<number>`count(*)` }).from(repos).get();
  return row?.c ?? 0;
}

/** Evict the lowest-value repos when the corpus exceeds `cap`. */
export function evictToCap(cap: number): number {
  const db = getDb();
  const total = countRepos();
  if (total <= cap) return 0;
  const excess = total - cap;
  // Lowest value = lowest stars among repos nobody has liked/saved, oldest
  // ingested first. Engagement (likes/saves) protects a row from eviction.
  const rows = db
    .select({ id: repos.id })
    .from(repos)
    .where(
      sql`${repos.id} NOT IN (SELECT repo_id FROM repo_feedback WHERE feedback = 'like')
          AND ${repos.id} NOT IN (SELECT repo_id FROM saved_ideas)`,
    )
    .orderBy(sql`${repos.stars} ASC, ${repos.ingested_at} ASC`)
    .limit(excess)
    .all();
  for (const r of rows) {
    db.delete(repos).where(eq(repos.id, r.id)).run();
    deleteRepoVector(r.id);
    deleteRepoFts(r.id);
  }
  return rows.length;
}
