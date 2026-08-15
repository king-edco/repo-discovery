import { getSqlite } from "@/db";

// --- FTS5 full-text index ------------------------------------------------
// Standalone FTS5 tables (not external-content) that store a copy of the
// searchable text. Like the vec0 tables, these are rebuildable search indexes;
// the canonical text lives on `repos` / `demand_signals`. Rebuilt by
// `pnpm reindex-search`.

export function createFtsTables(): void {
  const db = getSqlite();
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
      id UNINDEXED,
      full_name,
      description,
      readme_text,
      tokenize = 'porter unicode61'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS demand_signals_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tokenize = 'porter unicode61'
    );
  `);
}

/**
 * Sanitize a free-text query into a safe FTS5 MATCH expression. FTS5 syntax
 * treats bare words as an implicit AND and reserves characters like ", *, (,
 * -, OR, NOT. To stay robust against arbitrary user input we quote every token
 * in double quotes (escaping inner quotes) and AND them. Empty/no-alnum input
 * yields "" which we report via the returned null so callers can skip FTS.
 */
export function buildFtsQuery(text: string): string | null {
  const tokens = (text.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

export type FtsHit = { id: string; rank: number };

/**
 * BM25 search over an FTS5 table. `bm25()` returns a negative score (more
 * negative = more relevant), so we ORDER BY rank ASC and keep the raw value;
 * the hybrid layer only needs the ordering, not the absolute magnitude.
 * Returns [] if the query is null/empty or FTS errors (e.g. syntax edge
 * case) — the hybrid layer then falls back to vector-only.
 */
function ftsSearch(
  table: "repos_fts" | "demand_signals_fts",
  query: string | null,
  k: number,
): FtsHit[] {
  if (!query) return [];
  const db = getSqlite();
  try {
    const rows = db
      .prepare(
        `SELECT id, bm25(${table}) AS rank
         FROM ${table}
         WHERE ${table} MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, k) as FtsHit[];
    return rows;
  } catch (err) {
    // A pathological MATCH expression can still throw (e.g. all-stopword
    // query). Treat as "no FTS signal" rather than failing the whole search.
    console.warn(`[fts] ${table} MATCH failed for "${query}":`, (err as Error).message);
    return [];
  }
}

export function ftsSearchRepos(query: string | null, k: number): FtsHit[] {
  return ftsSearch("repos_fts", query, k);
}

export function ftsSearchDemandSignals(query: string | null, k: number): FtsHit[] {
  return ftsSearch("demand_signals_fts", query, k);
}

/** Upsert a repo's text into the FTS index (delete + reinsert by id). */
export function upsertRepoFts(
  repoId: string,
  fullName: string,
  description: string | null | undefined,
  readmeText: string | null | undefined,
): void {
  const db = getSqlite();
  db.prepare("DELETE FROM repos_fts WHERE id = ?").run(repoId);
  db.prepare(
    "INSERT INTO repos_fts (id, full_name, description, readme_text) VALUES (?, ?, ?, ?)",
  ).run(repoId, fullName ?? "", description ?? "", readmeText ?? "");
}

/** Upsert a demand signal's text into the FTS index (delete + reinsert by id). */
export function upsertDemandFts(
  signalId: string,
  title: string,
  content: string | null | undefined,
): void {
  const db = getSqlite();
  db.prepare("DELETE FROM demand_signals_fts WHERE id = ?").run(signalId);
  db.prepare(
    "INSERT INTO demand_signals_fts (id, title, content) VALUES (?, ?, ?)",
  ).run(signalId, title ?? "", content ?? "");
}
