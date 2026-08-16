import { getLoadablePath } from "sqlite-vec";
import { getSqlite } from "@/db";

// --- sqlite-vec vector index ---------------------------------------------
// vec0 virtual tables are SEARCH INDEXES, not the source of truth. The
// canonical 384-dim embedding lives in the JSON `embedding` column on the
// `repos` / `demand_signals` tables; the vec0 tables here are rebuildable
// projections of that data for fast KNN. If a vec0 table ever drifts or the
// model changes, `pnpm reindex-search` rebuilds it from the JSON column.

export const EMBEDDING_DIM = 384;

let extensionLoaded = false;

/**
 * Ensure the sqlite-vec loadable extension is loaded on the underlying
 * better-sqlite3 Database handle. Idempotent — safe to call from any code path
 * (server start, scripts, getDb consumers). Throws if the extension can't load
 * (e.g. ABI mismatch with the better-sqlite3 build), which is a fatal config
 * error we want surfaced loudly rather than silently degraded.
 */

// The raw better-sqlite3 handle exposes loadExtension natively. Throws if the
// extension binary can't load (ABI mismatch) — a fatal config error we want
// surfaced loudly rather than silently degrading to pure-cosine search.
// sqlite-vec is listed in next.config.ts serverExternalPackages, so this
// import resolves against the real node_modules at runtime (not the bundle),
// and getLoadablePath()'s require.resolve works correctly there.
export function ensureVecExtension(): void {
  if (extensionLoaded) return;
  const db = getSqlite();
  db.loadExtension(getLoadablePath());
  extensionLoaded = true;
}

/**
 * Create the vec0 virtual tables if they don't exist. Called once at DB init.
 * We guard with ensureVecExtension so the tables only exist when the extension
 * is available — the app stays usable (just without hybrid search) if vec is
 * somehow missing, and the reindex script will error clearly instead.
 */
export function createVecTables(): void {
  try {
    ensureVecExtension();
  } catch (err) {
    console.warn(
      "[vec] sqlite-vec extension unavailable — hybrid search disabled:",
      (err as Error).message,
    );
    return;
  }
  const db = getSqlite();
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS repo_vectors USING vec0(
      repo_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS demand_vectors USING vec0(
      signal_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS competitor_vectors USING vec0(
      competitor_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
  `);
}

/** Encode a number[] embedding as the little-endian float32 Blob vec0 expects. */
export function encodeVector(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf;
}

/** Decode a JSON embedding column back to number[] (the canonical form). */
export function decodeJsonEmbedding(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as number[];
    return Array.isArray(v) && v.length === EMBEDDING_DIM ? v : null;
  } catch {
    return null;
  }
}

/** Upsert a repo's vector into the vec0 index. No-op if `vec` is null/empty. */
export function upsertRepoVector(repoId: string, vec: number[] | null): void {
  const db = getSqlite();
  // vec0 has no native ON CONFLICT upsert; delete-then-insert is the supported
  // pattern and is cheap (single-row PK lookup + write).
  db.prepare("DELETE FROM repo_vectors WHERE repo_id = ?").run(repoId);
  if (vec && vec.length === EMBEDDING_DIM) {
    db.prepare(
      "INSERT INTO repo_vectors (repo_id, embedding) VALUES (?, ?)",
    ).run(repoId, encodeVector(vec));
  }
}

/** Upsert a demand signal's vector into the vec0 index. */
export function upsertDemandVector(signalId: string, vec: number[] | null): void {
  const db = getSqlite();
  db.prepare("DELETE FROM demand_vectors WHERE signal_id = ?").run(signalId);
  if (vec && vec.length === EMBEDDING_DIM) {
    db.prepare(
      "INSERT INTO demand_vectors (signal_id, embedding) VALUES (?, ?)",
    ).run(signalId, encodeVector(vec));
  }
}

/** Upsert a commercial competitor's vector into the vec0 index. */
export function upsertCompetitorVector(competitorId: string, vec: number[] | null): void {
  const db = getSqlite();
  db.prepare("DELETE FROM competitor_vectors WHERE competitor_id = ?").run(competitorId);
  if (vec && vec.length === EMBEDDING_DIM) {
    db.prepare(
      "INSERT INTO competitor_vectors (competitor_id, embedding) VALUES (?, ?)",
    ).run(competitorId, encodeVector(vec));
  }
}

export type VectorHit = { id: string; distance: number };

/**
 * KNN search over a vec0 table. Returns the `k` nearest vectors to `query`,
 * ordered by ascending distance. On the L2-normalized e5 vectors, vec0's
 * default L2-squared distance is monotonic with (1 - cosine), so the ordering
 * is the cosine ordering — the absolute distance is converted to cosine at the
 * call site via distanceToCosine.
 */
function knnSearch(
  table: "repo_vectors" | "demand_vectors" | "competitor_vectors",
  idCol: string,
  query: number[],
  k: number,
): VectorHit[] {
  const db = getSqlite();
  const rows = db
    .prepare(
      `SELECT ${idCol} AS id, distance
       FROM ${table}
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    )
    .all(encodeVector(query), k) as VectorHit[];
  return rows;
}

export function knnRepos(query: number[], k: number): VectorHit[] {
  return knnSearch("repo_vectors", "repo_id", query, k);
}

export function knnDemandSignals(query: number[], k: number): VectorHit[] {
  return knnSearch("demand_vectors", "signal_id", query, k);
}

export function knnCompetitors(query: number[], k: number): VectorHit[] {
  return knnSearch("competitor_vectors", "competitor_id", query, k);
}

/**
 * Convert a vec0 L2-squared distance (on unit-normalized vectors) to a cosine
 * similarity in [-1, 1]. For unit vectors, ||a-b||² = 2 - 2·cos(a,b), so
 * cos = 1 - distance/2. We clamp for float drift.
 */
export function distanceToCosine(distance: number): number {
  return Math.max(-1, Math.min(1, 1 - distance / 2));
}
