import { getRecommendations } from "@/lib/recommendation";
import { isValidEntityId } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Caps keep an attacker from passing enormous lists that would turn into huge
// SQL IN() clauses and unbounded centroid/KNN work per request.
const MAX_LIST = 200;
const MAX_INTERESTS = 50;
const MAX_PARAM_CHARS = 64;

function parseIdList(raw: string | null, max: number): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().slice(0, MAX_PARAM_CHARS))
    .filter((s) => s.length > 0 && isValidEntityId(s))
    .slice(0, max);
}

// GET /api/recommend?interests=react,python&liked=id1,id2&disliked=id3&limit=24&offset=0
// Returns the adaptive feed: repos ranked by interest match + semantic
// affinity (centroid of liked repos) + popularity. Disliked repos excluded.
// The user comes from the session.
export async function GET(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const sp = new URL(request.url).searchParams;

  const interests = parseIdList(sp.get("interests"), MAX_INTERESTS);
  const liked = parseIdList(sp.get("liked"), MAX_LIST);
  const disliked = parseIdList(sp.get("disliked"), MAX_LIST);
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 24;
  const offsetRaw = Number(sp.get("offset"));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const recs = getRecommendations({ userId: user.id, interests, likedRepoIds: liked, dislikedRepoIds: disliked, limit, offset });
  return Response.json(recs);
}
