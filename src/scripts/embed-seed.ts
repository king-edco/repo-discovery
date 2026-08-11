// Generate embeddings for any seeded repos that are missing them, so the
// semantic search endpoint returns results in dev/test.
import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { getEmbedder } from "@/lib/embeddings";

const README_EMBED_CHARS = 500;

async function main() {
  const db = getDb();

  const all = db
    .select({ id: repos.id, description: repos.description, readme_text: repos.readme_text, embedding: repos.embedding })
    .from(repos)
    .all();
  const missing = all.filter((r) => !r.embedding);

  if (missing.length === 0) {
    console.log("[embed-seed] all repos already have embeddings");
    return;
  }

  console.log(`[embed-seed] generating embeddings for ${missing.length} repos…`);
  const embedder = await getEmbedder();

  for (const repo of missing) {
    const text = [repo.description ?? "", (repo.readme_text ?? "").slice(0, README_EMBED_CHARS)].join("\n").trim();
    const vec = text ? await embedder.embed(text) : [];
    db.update(repos).set({ embedding: JSON.stringify(vec) }).where(eq(repos.id, repo.id)).run();
    console.log(`  · ${repo.id} (${vec.length} dims)`);
  }

  const withEmbed = db.select({ id: repos.id }).from(repos).where(isNotNull(repos.embedding)).all();
  console.log(`[embed-seed] done — ${withEmbed.length} repos now have embeddings`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
