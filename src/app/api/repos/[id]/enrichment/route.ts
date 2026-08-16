import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { computeCommercialScore, findCompetitors, findRelatedDemandSignals } from "@/lib/hybrid-search";
import { generateEnrichment, enrichmentAvailable } from "@/lib/ai-enrichment";

export const dynamic = "force-dynamic";

// GET /api/repos/[id]/enrichment
// Returns the cached plain-language summary + business pitch for a repo. If
// not yet generated (or stale), generates on demand using the heuristic (or
// Gemini if GEMINI_API_KEY is set), caches to the repos row, then returns.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const force = new URL(request.url).searchParams.get("force") === "1";

  const db = getDb();
  const repo = db
    .select({
      id: repos.id, name: repos.name, full_name: repos.full_name,
      description: repos.description, readme_text: repos.readme_text,
      topics: repos.topics, language: repos.language, license: repos.license,
      stars: repos.stars, embedding: repos.embedding,
      plain_summary: repos.plain_summary, business_pitch: repos.business_pitch,
      enrichment_source: repos.enrichment_source, enriched_at: repos.enriched_at,
    })
    .from(repos)
    .where(eq(repos.id, id))
    .get();

  if (!repo) return Response.json({ error: "repo not found" }, { status: 404 });

  // Serve cached enrichment unless force-regenerate.
  if (!force && repo.plain_summary && repo.business_pitch) {
    return Response.json({
      plainSummary: repo.plain_summary,
      businessPitch: repo.business_pitch,
      source: repo.enrichment_source ?? "heuristic",
      cachedAt: repo.enriched_at,
      geminiAvailable: enrichmentAvailable(),
    });
  }

  const repoVec = repo.embedding ? (JSON.parse(repo.embedding) as number[]) : null;
  const commercialScore = computeCommercialScore(repo, repoVec);
  const competitors = findCompetitors(repo, repoVec);
  const demandSignals = findRelatedDemandSignals(repo, repoVec);

  const enrichment = await generateEnrichment(repo, { commercialScore, competitors, demandSignals });

  // Cache to the repos row.
  const now = new Date().toISOString();
  db.update(repos)
    .set({
      plain_summary: enrichment.plainSummary,
      business_pitch: enrichment.businessPitch,
      enrichment_source: enrichment.source,
      enriched_at: now,
    })
    .where(eq(repos.id, id))
    .run();

  return Response.json({
    ...enrichment,
    cachedAt: now,
    geminiAvailable: enrichmentAvailable(),
  });
}
