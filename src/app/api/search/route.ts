import { desc, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { cosineSimilarity, getEmbedder } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

type SearchHit = {
  id: string;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  license: string | null;
  readme_text: string | null;
  topics: string;
  pushed_at: string;
  ingested_at: string;
  similarity: number;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return Response.json(
      { error: "Missing or empty 'q' query parameter." },
      { status: 400 },
    );
  }

  const embedder = await getEmbedder();
  const queryVec = await embedder.embed(q);
  if (queryVec.length === 0) {
    return Response.json(
      { error: "Could not generate an embedding for the query." },
      { status: 400 },
    );
  }

  const db = getDb();
  const rows = db
    .select({
      id: repos.id,
      name: repos.name,
      full_name: repos.full_name,
      description: repos.description,
      url: repos.url,
      stars: repos.stars,
      language: repos.language,
      license: repos.license,
      readme_text: repos.readme_text,
      embedding: repos.embedding,
      topics: repos.topics,
      pushed_at: repos.pushed_at,
      ingested_at: repos.ingested_at,
    })
    .from(repos)
    .where(isNotNull(repos.embedding))
    .orderBy(desc(repos.stars))
    .all();

  const hits: SearchHit[] = rows
    .map((r) => {
      const repoVec = r.embedding ? (JSON.parse(r.embedding) as number[]) : [];
      return {
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        url: r.url,
        stars: r.stars,
        language: r.language,
        license: r.license,
        readme_text: r.readme_text,
        topics: r.topics,
        pushed_at: r.pushed_at,
        ingested_at: r.ingested_at,
        similarity: cosineSimilarity(queryVec, repoVec),
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  // Keep the embedding column out of the response.
  return Response.json({
    query: q,
    count: hits.length,
    results: hits,
  });
}
