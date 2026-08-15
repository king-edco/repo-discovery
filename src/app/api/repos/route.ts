import { desc, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { computeCommercialScore } from "@/lib/hybrid-search";

export const dynamic = "force-dynamic";

function parseMinStars(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Paginate the feed: returning every repo in one response is a scaling bomb
// (one user opening the feed scans the whole table + transfers every row).
// `limit`/`offset` are the standard cursor-free window; the client's infinite
// scroll requests successive pages. `sort=score` ranks by the on-demand
// commercial score (computed only for the page, never the whole table).
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const minStars = parseMinStars(sp.get("minStars"));
  const sortBy = sp.get("sort");

  const limit = Math.min(
    Math.max(Number(sp.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const db = getDb();
  const baseQuery = db
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
      topics: repos.topics,
      pushed_at: repos.pushed_at,
      ingested_at: repos.ingested_at,
      embedding: repos.embedding,
    })
    .from(repos);

  // For score sort we must compute the score per repo, so we pull a candidate
  // window (stars-desc up to a cap), score each, and return the top `limit`.
  // This bounds work to the candidate window, not the whole table.
  if (sortBy === "score") {
    const candidateCap = Math.min(Math.max(offset + limit, limit * 4), 500);
    let candidates = baseQuery.orderBy(desc(repos.stars)).all();
    if (minStars !== null) {
      candidates = candidates.filter((r) => r.stars >= minStars);
    }
    candidates = candidates.slice(0, candidateCap);
    const scored = candidates.map((r) => {
      const repoVec = r.embedding ? (JSON.parse(r.embedding) as number[]) : null;
      const { embedding: _emb, ...rest } = r;
      void _emb;
      const score = computeCommercialScore(rest, repoVec);
      return { ...rest, commercialScore: score.score };
    });
    scored.sort((a, b) => b.commercialScore - a.commercialScore);
    const page = scored.slice(offset, offset + limit).map(({ commercialScore, ...r }) => ({
      ...r,
      commercialScore,
    }));
    return Response.json(page);
  }

  // Default: stars-desc, paginated.
  const query = minStars !== null
    ? baseQuery.where(gte(repos.stars, minStars)).orderBy(desc(repos.stars))
    : baseQuery.orderBy(desc(repos.stars));
  const rows = query.limit(limit).offset(offset).all();

  // Strip the embedding column from responses (keep payloads small). The
  // `commercialScore` field is omitted unless requested to avoid per-row work.
  const out = rows.map(({ embedding: _emb, ...r }) => {
    void _emb;
    return r;
  });
  return Response.json(out);
}
