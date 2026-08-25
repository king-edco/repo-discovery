import { getEmbedder } from "@/lib/embeddings";
import { searchRepos } from "@/lib/hybrid-search";

export const dynamic = "force-dynamic";

// Every search runs a CPU-heavy ONNX embedding; cap the query length so a
// single request can't amplify that cost arbitrarily.
const MAX_QUERY_LEN = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return Response.json(
      { error: "Missing or empty 'q' query parameter." },
      { status: 400 },
    );
  }
  if (q.length > MAX_QUERY_LEN) {
    return Response.json(
      { error: `Query too long (max ${MAX_QUERY_LEN} characters).` },
      { status: 400 },
    );
  }

  const embedder = await getEmbedder();
  const queryVec = await embedder.embedQuery(q);
  if (queryVec.length === 0) {
    return Response.json(
      { error: "Could not generate an embedding for the query." },
      { status: 400 },
    );
  }

  // Optional minimum-star filter (matches the feed setting).
  const minStarsRaw = searchParams.get("minStars");
  const minStars =
    minStarsRaw !== null &&
    Number.isFinite(Number(minStarsRaw)) &&
    Number(minStarsRaw) > 0
      ? Math.floor(Number(minStarsRaw))
      : null;

  // Hybrid search: sqlite-vec KNN (cosine) + FTS5 BM25, fused by RRF.
  const hits = searchRepos(queryVec, q, { minStars });

  // Keep the embedding column out of the response.
  return Response.json({
    query: q,
    count: hits.length,
    results: hits,
  });
}
