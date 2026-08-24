import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { computeCommercialScore, findCompetitors, findRelatedDemandSignals } from "@/lib/hybrid-search";
import { generateEnrichment, enrichmentAvailable } from "@/lib/ai-enrichment";
import { isAdminRequest } from "@/lib/security";
import { isPro, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/repos/[id]/enrichment
// Returns the cached plain-language summary + business pitch for a repo. If
// not yet generated (or stale), generates on demand using the heuristic (or
// Gemini if GEMINI_API_KEY is set), caches to the repos row, then returns.
// The plain summary is free; the business pitch is cross-data (competitors,
// demand signals, commercial score) and only returned to Pro users.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { user, error: authError } = await requireUser();
  if (authError) return authError;
  const pro = isPro(user);
  // Force-regeneration spends paid Gemini quota and writes to the DB, so it
  // requires the server-configured ENRICHMENT_ADMIN_KEY (x-admin-key header).
  // Without it, `force` is rejected and only the cached/heuristic path runs.
  const wantsForce = new URL(request.url).searchParams.get("force") === "1";
  if (wantsForce && !isAdminRequest(request)) {
    return Response.json(
      { error: "force regeneration requires admin authorization." },
      { status: 403 },
    );
  }
  const force = wantsForce;

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
      businessPitch: pro ? repo.business_pitch : null,
      pitchLocked: !pro,
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
    plainSummary: enrichment.plainSummary,
    businessPitch: pro ? enrichment.businessPitch : null,
    pitchLocked: !pro,
    source: enrichment.source,
    cachedAt: now,
    geminiAvailable: enrichmentAvailable(),
  });
}
