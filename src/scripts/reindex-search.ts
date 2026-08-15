import { isNotNull } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { demandSignals, repos } from "@/db/schema";
import {
  createVecTables,
  decodeJsonEmbedding,
  ensureVecExtension,
  upsertDemandVector,
  upsertRepoVector,
} from "@/lib/vector-db";
import { createFtsTables, upsertDemandFts, upsertRepoFts } from "@/lib/fts";

// Rebuild the sqlite-vec (vec0) and FTS5 search indexes from the canonical
// data in `repos` / `demand_signals`. The JSON `embedding` column remains the
// source of truth; the indexes are rebuildable projections. Run after a model
// change, a schema change, or any time the indexes are suspected to have
// drifted (e.g. a crashed ingest). Safe to re-run.
//
//   pnpm reindex-search

function dropIndexes(): void {
  const db = getSqlite();
  db.exec(`
    DROP TABLE IF EXISTS repo_vectors;
    DROP TABLE IF EXISTS demand_vectors;
    DROP TABLE IF EXISTS repos_fts;
    DROP TABLE IF EXISTS demand_signals_fts;
  `);
}

function main(): void {
  const t0 = Date.now();
  console.log("[reindex] rebuilding sqlite-vec + FTS5 search indexes");

  // Load the extension first so createVecTables can run, then drop+recreate
  // everything from a clean slate (idempotent, always reflects canonical data).
  ensureVecExtension();
  dropIndexes();
  createVecTables();
  createFtsTables();

  // Drizzle wrapper for typed queries; raw handle is used for index DDL above.
  const db = getDb();

  // --- repos: vector + FTS ---
  const repoRows = db
    .select({
      id: repos.id,
      name: repos.name,
      full_name: repos.full_name,
      description: repos.description,
      readme_text: repos.readme_text,
      embedding: repos.embedding,
    })
    .from(repos)
    .all();

  let repoVec = 0;
  let repoFts = 0;
  for (const r of repoRows) {
    const vec = decodeJsonEmbedding(r.embedding);
    if (vec) {
      upsertRepoVector(r.id, vec);
      repoVec++;
    }
    upsertRepoFts(r.id, r.full_name, r.description, r.readme_text);
    repoFts++;
  }
  console.log(
    `[reindex] repos: ${repoRows.length} rows — ${repoVec} vectors, ${repoFts} FTS docs`,
  );

  // --- demand signals: vector + FTS ---
  const signalRows = db
    .select({
      id: demandSignals.id,
      title: demandSignals.title,
      content: demandSignals.content,
      embedding: demandSignals.embedding,
    })
    .from(demandSignals)
    .where(isNotNull(demandSignals.embedding))
    .all();

  let sigVec = 0;
  let sigFts = 0;
  for (const s of signalRows) {
    const vec = decodeJsonEmbedding(s.embedding);
    if (vec) {
      upsertDemandVector(s.id, vec);
      sigVec++;
    }
    upsertDemandFts(s.id, s.title, s.content);
    sigFts++;
  }
  console.log(
    `[reindex] demand_signals: ${signalRows.length} rows — ${sigVec} vectors, ${sigFts} FTS docs`,
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[reindex] done in ${elapsed}s`);
}

main();
