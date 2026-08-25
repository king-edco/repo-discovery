import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { findCompetitors } from "@/lib/hybrid-search";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Commercial competitors for a repo, found by hybrid vector KNN + FTS5 over
// the `market_competitors` corpus (Wikidata software products). The matching
// is embedding-driven, so it works for any repo without category wiring.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cross-data matching is a Pro feature.
  const { error } = await requireUser({ pro: true });
  if (error) return error;

  const db = getDb();
  const repo = db
    .select({
      id: repos.id,
      name: repos.name,
      full_name: repos.full_name,
      description: repos.description,
      topics: repos.topics,
      embedding: repos.embedding,
    })
    .from(repos)
    .where(eq(repos.id, id))
    .get();

  if (!repo) {
    return Response.json({ error: "Repo not found." }, { status: 404 });
  }

  const repoVec = repo.embedding ? (JSON.parse(repo.embedding) as number[]) : null;

  const { searchParams } = new URL(request.url);
  const topRaw = searchParams.get("topN");
  const topN =
    topRaw !== null && Number.isFinite(Number(topRaw)) && Number(topRaw) > 0
      ? Math.min(Math.floor(Number(topRaw)), 20)
      : undefined;

  const competitors = findCompetitors(repo, repoVec, { topN });

  return Response.json({
    repoId: repo.id,
    count: competitors.length,
    results: competitors,
  });
}
