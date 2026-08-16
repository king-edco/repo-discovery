import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { computeCommercialScore } from "@/lib/hybrid-search";

export const dynamic = "force-dynamic";

// On-demand commercial-potential score for a repo. Folds three axes into a
// single 0–100: demand-signal intensity, license commercial-friendliness, and
// competitive saturation. Never stored — recomputed per request (cheap at
// current volumes).

export async function GET(
  _request: Request,
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
      license: repos.license,
      embedding: repos.embedding,
    })
    .from(repos)
    .where(eq(repos.id, id))
    .get();

  if (!repo) {
    return Response.json({ error: "Repo not found." }, { status: 404 });
  }

  const repoVec = repo.embedding ? (JSON.parse(repo.embedding) as number[]) : null;
  const score = computeCommercialScore(repo, repoVec);

  return Response.json({ repoId: repo.id, ...score });
}
