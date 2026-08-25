import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { computeCommercialScore } from "@/lib/hybrid-search";
import { isPro, requireUser } from "@/lib/session";
import { isValidEntityId } from "@/lib/security";

export const dynamic = "force-dynamic";

// Topics the feed can scope a sort by, so "Stars" / "Potential" rank the
// repos that match the user's interests rather than the global top list.
const MAX_INTERESTS = 50;
const MAX_TOPIC_CHARS = 64;

function parseInterests(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase().slice(0, MAX_TOPIC_CHARS))
    .filter((s) => s.length > 0 && isValidEntityId(s))
    .slice(0, MAX_INTERESTS);
}

// SQL fragment matching repos whose topics JSON contains any interest.
// We use json_each on the topics column to match EXACT tag names, not
// substring LIKE (which leaked e.g. "game" matching "2d-game").
// Topics are pre-validated to [A-Za-z0-9_-] so inlining is SQL-safe.
function interestWhere(interests: string[]) {
  const list = interests
    .map((t) => `'${t.replace(/"/g, "").replace(/'/g, "")}'`)
    .join(", ");
  return sql`EXISTS (SELECT 1 FROM json_each(${repos.topics}) je WHERE je.value IN (${sql.raw(list)}))`;
}

// AND together the minStars filter and the interest filter into one WHERE,
// so we only ever single-call `.where` (drizzle forbids chaining).
function combineFilters(minStars: number | null, interests: string[]) {
  const parts: ReturnType<typeof sql>[] = [];
  if (minStars !== null) parts.push(sql`${repos.stars} >= ${minStars}`);
  if (interests.length > 0) parts.push(interestWhere(interests));
  if (parts.length === 0) return undefined;
  return sql`(${sql.join(parts, sql` AND `)})`;
}

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
  const { user, error } = await requireUser();
  if (error) return error;

  const sp = new URL(request.url).searchParams;
  const minStars = parseMinStars(sp.get("minStars"));
  const sortBy = sp.get("sort");
  // Interests scoped into the sort: /api/repos?sort=stars&interests=game,godot
  // ranks game/godot repos by stars instead of the global star list.
  const interests = parseInterests(sp.get("interests"));

  // sort=score ranks by the commercial score, which is derived from
  // cross-data matching — a Pro feature.
  if (sortBy === "score" && !isPro(user)) {
    return Response.json(
      { error: "Score ranking requires the Pro plan.", upgrade: true },
      { status: 403 },
    );
  }

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
    // Bound the read in SQL: loading the whole table (including the ~7KB
    // embedding JSON per row) on every request is a DoS amplifier.
    const where = combineFilters(minStars, interests);
    const candidates = (where
      ? baseQuery.where(where).orderBy(desc(repos.stars))
      : baseQuery.orderBy(desc(repos.stars))
    ).limit(candidateCap).all();
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

  // Default: stars-desc, paginated. Scoped to interests when provided.
  const where = combineFilters(minStars, interests);
  let rows = (where
    ? baseQuery.where(where).orderBy(desc(repos.stars))
    : baseQuery.orderBy(desc(repos.stars))
  )
    .limit(limit)
    .offset(offset)
    .all();
  // Empty page on the first request would blank the feed; fall back to the
  // global (unfiltered) stars list so "Stars" always has content.
  if (rows.length === 0 && interests.length > 0 && offset === 0) {
    rows = baseQuery.orderBy(desc(repos.stars)).limit(limit).offset(offset).all();
  }

  // Strip the embedding column from responses (keep payloads small). The
  // `commercialScore` field is omitted unless requested to avoid per-row work.
  const out = rows.map(({ embedding: _emb, ...r }) => {
    void _emb;
    return r;
  });
  return Response.json(out);
}
