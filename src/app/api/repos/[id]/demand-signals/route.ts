import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { findRelatedDemandSignals } from "@/lib/hybrid-search";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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

  const repoVec = repo.embedding
    ? (JSON.parse(repo.embedding) as number[])
    : null;

  const { searchParams } = new URL(request.url);
  const topRaw = searchParams.get("topN");

  const topN =
    topRaw !== null && Number.isFinite(Number(topRaw)) && Number(topRaw) > 0
      ? Math.min(Math.floor(Number(topRaw)), 50)
      : undefined;

  const matches = findRelatedDemandSignals(repo, repoVec, { topN });

  return Response.json({
    repoId: repo.id,
    count: matches.length,
    results: matches,
  });
}
