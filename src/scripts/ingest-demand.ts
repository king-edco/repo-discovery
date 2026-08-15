import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { demandSignals, type NewDemandSignal } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { upsertDemandVector } from "@/lib/vector-db";
import { upsertDemandFts } from "@/lib/fts";
import { DEMAND_NICHES } from "@/lib/demand-niches";
import {
  buildClients,
  currentsQuotaUsed,
  CURRENTS_HARD_LIMIT,
  CURRENTS_SOFT_LIMIT,
  type RawDemandItem,
} from "@/lib/demand-sources";

// Per-niche request budgets. With ~28 niches and a 250/day Currents cap:
//   28 niches * 8 req = 224  -> fits under the 230 soft limit with margin.
// HN and Stack Exchange have no comparable strict cap, so a few more hits each.
const HN_PER_NICHE = 8;
const SE_PER_NICHE = 8;
const CURRENTS_PER_NICHE = 8;
const DELAY_MS = 250;

// How many chars of (title + content) get embedded. Keeps embedding input
// bounded and comparable across sources.
const EMBED_TEXT_MAX = 800;

function embedTextFor(item: RawDemandItem): string {
  const parts = [item.title, item.content ?? ""].filter(Boolean);
  return parts.join("\n").slice(0, EMBED_TEXT_MAX);
}

function signalId(item: RawDemandItem): string {
  return `${item.source}:${item.external_id}`;
}

async function main() {
  const t0 = Date.now();
  console.log("[ingest-demand] starting unified demand-signal ingestion");
  console.log(`[ingest-demand] niches: ${DEMAND_NICHES.length}`);

  // Show the Currents budget up front so the operator knows the headroom.
  const usedBefore = currentsQuotaUsed();
  console.log(
    `[ingest-demand] currents quota: ${usedBefore}/${CURRENTS_HARD_LIMIT} used today (soft stop at ${CURRENTS_SOFT_LIMIT})`,
  );

  const clients = buildClients({
    hnPerNiche: HN_PER_NICHE,
    sePerNiche: SE_PER_NICHE,
    currentsPerNiche: CURRENTS_PER_NICHE,
    delayMs: DELAY_MS,
  });
  console.log(
    `[ingest-demand] sources: ${clients.map((c) => c.source).join(", ")}`,
  );

  // The niche list is already ordered by descending importance (tech/AI first,
  // where demand signal is most actionable). We process niches in that order
  // so if the Currents quota exhausts mid-run, the most important niches are
  // already covered. Within a niche we query HN and SE first (uncapped), then
  // Currents last so a quota stop can't block the free sources.
  const embedder = await getEmbedder();
  const db = getDb();

  let totalFetched = 0;
  let totalUpserted = 0;
  const bySource: Record<string, number> = {};

  for (let i = 0; i < DEMAND_NICHES.length; i++) {
    const niche = DEMAND_NICHES[i];
    console.log(
      `[ingest-demand] (${i + 1}/${DEMAND_NICHES.length}) niche: "${niche}"`,
    );

    // Free sources first (no shared quota), Currents last.
    const ordered = [...clients].sort((a, b) => {
      const w = (s: string) => (s === "currents" ? 1 : 0);
      return w(a.source) - w(b.source);
    });

    for (const client of ordered) {
      const items = await client.fetch(niche);
      if (items.length === 0) continue;

      // Embed all items for this source/niche in one batched loop.
      const rows: NewDemandSignal[] = [];
      for (const item of items) {
        const vec = await embedder.embedPassage(embedTextFor(item));
        rows.push({
          id: signalId(item),
          source: item.source,
          external_id: item.external_id,
          niche_keyword: item.niche_keyword,
          title: item.title,
          content: item.content,
          url: item.url,
          score: item.score,
          num_comments: item.num_comments,
          created_at: item.created_at,
          embedding: vec.length ? JSON.stringify(vec) : null,
        });
      }

      // Upsert deduplicated on id (= source:external_id). ON CONFLICT updates
      // mutable fields (score, comments, content, embedding, niche, ingested_at)
      // so re-running the script refreshes data instead of creating duplicates.
      let upserted = 0;
      db.transaction((tx) => {
        for (const row of rows) {
          const res = tx
            .insert(demandSignals)
            .values(row)
            .onConflictDoUpdate({
              target: demandSignals.id,
              set: {
                source: row.source,
                external_id: row.external_id,
                niche_keyword: row.niche_keyword,
                title: row.title,
                content: row.content,
                url: row.url,
                score: row.score,
                num_comments: row.num_comments,
                created_at: row.created_at,
                embedding: row.embedding,
                ingested_at: new Date().toISOString(),
              },
            })
            .run();
          upserted += res.changes;
        }
      });

      // Sync the search indexes (vec0 + FTS5) with the canonical rows. Done
      // outside the Drizzle transaction because vec0/FTS5 use raw SQL on the
      // better-sqlite3 handle; the indexes are rebuildable via reindex-search
      // if this step is ever interrupted.
      for (const row of rows) {
        const vec = row.embedding ? (JSON.parse(row.embedding) as number[]) : null;
        upsertDemandVector(row.id, vec);
        upsertDemandFts(row.id, row.title, row.content);
      }

      totalFetched += items.length;
      totalUpserted += upserted;
      bySource[client.source] = (bySource[client.source] ?? 0) + items.length;
      console.log(
        `  [${client.source}] fetched ${items.length}, upserted ${upserted}`,
      );
    }
  }

  const usedAfter = currentsQuotaUsed();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("---");
  console.log(`[ingest-demand] done in ${elapsed}s`);
  console.log(`[ingest-demand] fetched: ${totalFetched}, upserted: ${totalUpserted}`);
  console.log(
    `[ingest-demand] by source:`,
    Object.entries(bySource)
      .map(([k, v]) => `${k}=${v}`)
      .join(", "),
  );
  console.log(
    `[ingest-demand] currents quota: ${usedAfter}/${CURRENTS_HARD_LIMIT} used today`,
  );

  // Quick distinct-count sanity check (should equal totalUpserted on first run,
  // and stay stable on re-runs = no duplicates).
  const distinct = db
    .select({ c: sql<number>`count(distinct id)` })
    .from(demandSignals)
    .get();
  console.log(`[ingest-demand] distinct rows in demand_signals: ${distinct?.c ?? 0}`);
}

main().catch((err) => {
  console.error("[ingest-demand] fatal:", err);
  process.exit(1);
});
