import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";

// Length of README snippet blended into the embedded text. Must match ingest.ts
// so re-embedded vectors are comparable to freshly ingested ones.
const EMBED_README_CHARS = 500;
const LOG_EVERY = 100;

/**
 * Re-vectorize every repo already in the database with the current embedding
 * model, WITHOUT re-fetching anything from GitHub. Uses only the description +
 * README text already stored in SQLite. Run this after swapping the embedding
 * model: the old vectors (produced by the previous model) are invalid and would
 * break semantic search until regenerated.
 *
 * By default it re-embeds ALL repos. Pass `--empty-only` to skip repos that
 * already have an embedding (useful to backfill newly added rows without
 * touching the rest).
 */
async function main(): Promise<void> {
  const emptyOnly = process.argv.includes("--empty-only");

  const db = getDb();

  const totalRow = db
    .select({ c: sql<number>`count(*)` })
    .from(repos)
    .get();
  const total = totalRow?.c ?? 0;
  if (total === 0) {
    console.log("[reembed] no repos in DB. Run `pnpm ingest` first.");
    return;
  }

  const query = db
    .select({
      id: repos.id,
      full_name: repos.full_name,
      description: repos.description,
      readme_text: repos.readme_text,
      embedding: repos.embedding,
    })
    .from(repos);
  const rows = emptyOnly
    ? query.where(sql`${repos.embedding} IS NULL`).all()
    : query.all();

  const target = emptyOnly ? "repos with no embedding" : "all repos";
  console.log(
    `[reembed] ${rows.length}/${total} ${target} to re-embed (empty-only=${emptyOnly})`,
  );
  if (rows.length === 0) {
    console.log("[reembed] nothing to do.");
    return;
  }

  console.log("[reembed] loading model Xenova/multilingual-e5-small (q8)...");
  const embedder = await getEmbedder();
  console.log("[reembed] model loaded");

  let done = 0;
  let embedded = 0;
  const start = Date.now();

  for (const row of rows) {
    const desc = row.description ?? "";
    const readmeSnippet = row.readme_text
      ? row.readme_text.slice(0, EMBED_README_CHARS)
      : "";
    const embedText = `${desc}\n${readmeSnippet}`.trim();

    let embeddingJson: string | null = null;
    if (embedText) {
      const vec = await embedder.embedPassage(embedText);
      embeddingJson = vec.length > 0 ? JSON.stringify(vec) : null;
      if (embeddingJson) embedded++;
    }

    // Update only the embedding column; leave README/metadata untouched.
    db.update(repos)
      .set({ embedding: embeddingJson })
      .where(eq(repos.id, row.id))
      .run();

    done++;
    if (done % LOG_EVERY === 0) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      const rate = done / Math.max(elapsed, 1);
      const eta = Math.round((rows.length - done) / Math.max(rate, 0.01));
      console.log(
        `[reembed] ${done}/${rows.length} processed (${embedded} embedded) — ${elapsed}s elapsed, ~${eta}s eta`,
      );
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  const withEmbed = db
    .select({ c: sql<number>`count(*)` })
    .from(repos)
    .where(sql`${repos.embedding} IS NOT NULL`)
    .get();
  console.log(
    `\n[done] re-embedded ${embedded}/${rows.length} repos in ${elapsed}s. DB now has ${withEmbed?.c ?? 0}/${total} repos with embeddings.`,
  );
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
