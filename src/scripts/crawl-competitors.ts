import { getDb, getSqlite } from "@/db";
import { marketCompetitors } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";
import { crawlWikidataCompetitors } from "@/lib/competitor-sources";
import { upsertCompetitorVector } from "@/lib/vector-db";
import { upsertCompetitorFts } from "@/lib/fts";

// Crawl commercial competitor products from Wikidata (SPARQL), generate an
// e5 embedding for each, and upsert them into `market_competitors` + the
// competitor_vectors / competitors_fts search indexes.
//
//   pnpm crawl-competitors              # full crawl (all software classes)
//   pnpm crawl-competitors --only-stale # only re-crawl classes last fetched >7d ago
//
// Wikidata is a free, shared endpoint with no per-key daily cap, so we pace
// by class (one POST per class, ~1.5s apart) rather than hard-throttling like
// the Currents source. A class whose query fails is skipped, not fatal.

const STALE_DAYS = 7;
const EMBED_CONCURRENCY = 8;

function parseArgs(argv: string[]): { onlyStale: boolean } {
  return { onlyStale: argv.includes("--only-stale") };
}

function isStale(crawledAt: string | null): boolean {
  if (!crawledAt) return true;
  const ageMs = Date.now() - new Date(crawledAt).getTime();
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

// Build the embed input for a competitor: name + category + description. The
// category label adds topical signal (e.g. "video game engine") that a bare
// product name lacks, improving KNN neighbour quality against repo readmes.
function embedInput(c: {
  name: string;
  description: string | null;
  category: string | null;
}): string {
  const parts = [c.name];
  if (c.category) parts.push(c.category);
  if (c.description) parts.push(c.description);
  return parts.join(" — ").slice(0, 800);
}

async function embedBatch(
  embedder: Awaited<ReturnType<typeof getEmbedder>>,
  items: { id: string; input: string }[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  // Bounded concurrency so we don't spawn thousands of in-flight ONNX runs.
  for (let i = 0; i < items.length; i += EMBED_CONCURRENCY) {
    const batch = items.slice(i, i + EMBED_CONCURRENCY);
    const vectors = await Promise.all(
      batch.map(async (it) => {
        if (!it.input.trim()) return [];
        return embedder.embedPassage(it.input);
      }),
    );
    batch.forEach((it, idx) => out.set(it.id, vectors[idx]));
  }
  return out;
}

async function main(): Promise<void> {
  const { onlyStale } = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const db = getDb();
  const embedder = await getEmbedder();

  // Index existing competitors by id for stale checks + skip-existing logic.
  const existing = new Map(
    db
      .select({ id: marketCompetitors.id, crawled_at: marketCompetitors.crawled_at })
      .from(marketCompetitors)
      .all()
      .map((r) => [r.id, r.crawled_at]),
  );

  let totalCrawled = 0;
  let totalEmbedded = 0;
  let totalUpserted = 0;
  let classesSkipped = 0;

  for await (const products of crawlWikidataCompetitors({ delayMs: 1500 })) {
    if (products.length === 0) {
      classesSkipped++;
      continue;
    }

    // --only-stale: skip products already fresh (crawled within STALE_DAYS).
    // A product with no record is always considered stale.
    const toFetch = onlyStale
      ? products.filter((p) => isStale(existing.get(p.id) ?? null))
      : products;
    if (toFetch.length === 0) {
      console.log(
        `[competitors] class "${products[0]?.category ?? "?"}": ${products.length} products, all fresh — skipped`,
      );
      continue;
    }
    totalCrawled += toFetch.length;

    // Embed the batch.
    const embedInputs = toFetch.map((p) => ({ id: p.id, input: embedInput(p) }));
    const vectors = await embedBatch(embedder, embedInputs);
    totalEmbedded += vectors.size;

    // Upsert each competitor + its search indexes inside one transaction per
    // class batch. SQLite WAL keeps readers unblocked while we write.
    try {
      db.transaction((tx) => {
        for (const p of toFetch) {
          const vec = vectors.get(p.id) ?? [];
          const embeddingJson = vec.length > 0 ? JSON.stringify(vec) : null;
          const now = new Date().toISOString();
          tx.insert(marketCompetitors)
            .values({
              id: p.id,
              name: p.name,
              description: p.description,
              category: p.category,
              source_url: p.source_url,
              website: p.website,
              license: p.license,
              language: p.language,
              crawled_at: now,
              embedding: embeddingJson,
            })
            .onConflictDoUpdate({
              target: marketCompetitors.id,
              set: {
                name: p.name,
                description: p.description,
                category: p.category,
                website: p.website,
                license: p.license,
                language: p.language,
                crawled_at: now,
                embedding: embeddingJson,
              },
            })
            .run();
          // Keep the rebuildable search indexes in sync with the canonical row.
          // These use the shared handle (same connection), safe inside the tx.
          upsertCompetitorVector(p.id, vec);
          upsertCompetitorFts(p.id, p.name, p.description, p.category);
          totalUpserted++;
        }
      });
    } catch (err) {
      console.warn(
        `[competitors] upsert batch failed for class "${products[0]?.category ?? "?"}":`,
        (err as Error).message,
      );
    }

    console.log(
      `[competitors] class "${products[0]?.category ?? "?"}": +${toFetch.length} upserted (cumulative ${totalUpserted})`,
    );
  }

  // If --only-stale skipped everything, report the fresh count.
  if (onlyStale) {
    const fresh = existing.size - classesSkipped; // rough; real freshness is per-id
    console.log(`[competitors] --only-stale: ${existing.size} known, skipped fresh where possible`);
    void fresh;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[competitors] done in ${elapsed}s — crawled ${totalCrawled}, embedded ${totalEmbedded}, upserted ${totalUpserted}`,
  );

  // Verify: count competitors with embeddings.
  const totalRows = db.select({ id: marketCompetitors.id }).from(marketCompetitors).all().length;
  const withVec = getSqlite()
    .prepare("SELECT COUNT(*) AS n FROM market_competitors WHERE embedding IS NOT NULL")
    .get() as { n: number };
  console.log(
    `[competitors] market_competitors: ${totalRows} rows (${withVec.n} with embedding)`,
  );
}

main().catch((err) => {
  console.error("[competitors] fatal:", err);
  process.exit(1);
});
