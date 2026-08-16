import { getRecommendations } from "@/lib/recommendation";

export const dynamic = "force-dynamic";

// GET /api/recommend?userId=...&interests=react,python&liked=id1,id2&disliked=id3&limit=24&offset=0
// Returns the adaptive feed: repos ranked by interest match + semantic
// affinity (centroid of liked repos) + popularity. Disliked repos excluded.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const userId = sp.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const interests = (sp.get("interests") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const liked = (sp.get("liked") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const disliked = (sp.get("disliked") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const limit = sp.get("limit") ? Number(sp.get("limit")) : 24;
  const offset = sp.get("offset") ? Number(sp.get("offset")) : 0;

  const recs = getRecommendations({ userId, interests, likedRepoIds: liked, dislikedRepoIds: disliked, limit, offset });
  return Response.json(recs);
}
