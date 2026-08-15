import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { findRelatedDemandSignals } from "@/lib/demand-matching";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const db = getDb();
  const repo = db
    .select({ id: repos.id, embedding: repos.embedding })
    .from(repos)
    .where(eq(repos.id, id))
    .get();

  if (!repo) {
    return Response.json({ error: "Repo not found." }, { status: 404 });
  }

  const repoVec = repo.embedding ? (JSON.parse(repo.embedding) as number[]) : null;

  const { searchParams } = new URL(request.url);
  const minRaw = searchParams.get("minSimilarity");
  const topRaw = searchParams.get("topN");

  const minSimilarity =
    minRaw !== null && Number.isFinite(Number(minRaw)) && Number(minRaw) >= 0 && Number(minRaw) <= 1
      ? Number(minRaw)
      : undefined;
  const topN =
    topRaw !== null && Number.isFinite(Number(topRaw)) && Number(topRaw) > 0
      ? Math.min(Math.floor(Number(topRaw)), 50)
      : undefined;

  const matches = findRelatedDemandSignals(repoVec, { minSimilarity, topN });

  return Response.json({
    repoId: repo.id,
    count: matches.length,
    minSimilarity: minSimilarity ?? 0.75,
    results: matches,
  });
}
