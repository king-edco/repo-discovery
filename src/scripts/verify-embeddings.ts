import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";

async function main(): Promise<void> {
  const db = getDb();

  const total = db
    .select({ c: sql<number>`count(*)` })
    .from(repos)
    .get();
  const totalRows = total?.c ?? 0;

  const withEmbed = db
    .select({ c: sql<number>`count(*)` })
    .from(repos)
    .where(sql`${repos.embedding} IS NOT NULL`)
    .get();
  const withEmbedRows = withEmbed?.c ?? 0;

  console.log(`[stats] total repos: ${totalRows}`);
  console.log(`[stats] repos with embedding: ${withEmbedRows}/${totalRows}`);

  if (withEmbedRows === 0) {
    console.log("[verify] no embeddings found in DB. Run `pnpm ingest` first.");
    return;
  }

  // Inspect the dimension of a stored embedding.
  const sample = db
    .select({ full_name: repos.full_name, embedding: repos.embedding })
    .from(repos)
    .where(sql`${repos.embedding} IS NOT NULL`)
    .limit(1)
    .get();

  if (sample?.embedding) {
    const vec = JSON.parse(sample.embedding) as number[];
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    console.log(`[verify] sample repo: ${sample.full_name}`);
    console.log(`[verify] embedding dimension: ${vec.length}`);
    console.log(`[verify] L2 norm: ${norm.toFixed(4)} (normalized ≈ 1.0)`);
    console.log(`[verify] first 5 values: [${vec.slice(0, 5).map((v) => v.toFixed(6)).join(", ")}]`);
    if (vec.length === 384) {
      console.log("[verify] ✅ dimension is 384 (correct for all-MiniLM-L6-v2)");
    } else {
      console.log(`[verify] ❌ expected 384, got ${vec.length}`);
    }
  }

  // Also confirm the live model produces 384-dim vectors.
  console.log("[verify] loading model to confirm live output dimension...");
  const embedder = await getEmbedder();
  const live = await embedder.embed("semantic search test sentence");
  console.log(`[verify] live model embedding dimension: ${live.length}`);
  if (live.length === 384) {
    console.log("[verify] ✅ live model output is 384");
  } else {
    console.log(`[verify] ❌ live model expected 384, got ${live.length}`);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
