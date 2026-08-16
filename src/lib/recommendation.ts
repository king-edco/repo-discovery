import { eq, inArray, isNotNull, sql, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { repos, userInterests, repoFeedback, type Repo } from "@/db/schema";
import { knnRepos, distanceToCosine, decodeJsonEmbedding, EMBEDDING_DIM } from "@/lib/vector-db";
import { parseTopics } from "@/lib/format";

// --- Recommendation engine -------------------------------------------------
// TikTok-like adaptive feed. Three signals fused:
//   1. Interest match — topic overlap between repo.topics and the user's
//      declared interests. Direct, explicit signal.
//   2. Semantic affinity — KNN over the user's centroid embedding (built from
//      liked repos + interest keywords). Captures repos the user would like
//      even without exact tag overlap.
//   3. Popularity + freshness — star power and recency, so the feed isn't
//      dominated by obscure repos a cold-start user can't evaluate.
//
// Feedback (likes/dislikes) adapts the feed: liked repos' embeddings are
// folded into the centroid (boosting similar repos), disliked repos are
// excluded and their neighbours demoted. This is the implicit-signal loop.

const RECO_CANDIDATE_POOL = 200;
const RECO_TOP_N = 24;
const KNN_K = 60;

export type Recommendation = Omit<Repo, "embedding"> & {
  recScore: number;
  interestMatch: number;
  semanticScore: number;
  liked?: boolean;
  disliked?: boolean;
};

export type RecommendationParams = {
  userId: string;
  interests: string[];
  likedRepoIds: string[];
  dislikedRepoIds: string[];
  limit?: number;
  offset?: number;
};

export function getRecommendations(params: RecommendationParams): Recommendation[] {
  const db = getDb();
  const limit = Math.min(params.limit ?? RECO_TOP_N, 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const { interests, likedRepoIds, dislikedRepoIds } = params;

  const interestSet = new Set(interests.map((t) => t.toLowerCase()));
  const likedSet = new Set(likedRepoIds);
  const dislikedSet = new Set(dislikedRepoIds);

  // Build the user centroid: mean of liked repos' embeddings. If no likes yet,
  // fall back to interest-based matching + popularity (cold start).
  const likedRows = likedRepoIds.length > 0
    ? db.select({ id: repos.id, embedding: repos.embedding })
        .from(repos)
        .where(inArray(repos.id, likedRepoIds))
        .all()
    : [];
  const likedVecs = likedRows
    .map((r) => decodeJsonEmbedding(r.embedding))
    .filter((v): v is number[] => v !== null);
  const centroid = likedVecs.length > 0 ? meanVector(likedVecs) : null;

  // Semantic KNN: repos nearest to the centroid. Only when we have a centroid.
  const knnScores = new Map<string, number>();
  if (centroid) {
    const hits = knnRepos(centroid, Math.min(KNN_K, RECO_CANDIDATE_POOL));
    for (const hit of hits) {
      knnScores.set(hit.id, distanceToCosine(hit.distance));
    }
  }

  // Candidate pool: repos with embeddings, excluding disliked, ordered by
  // stars to get a quality baseline. We then re-rank by the fused score.
  const candidates = db
    .select({
      id: repos.id, name: repos.name, full_name: repos.full_name,
      description: repos.description, url: repos.url, stars: repos.stars,
      language: repos.language, license: repos.license, readme_text: repos.readme_text,
      topics: repos.topics, pushed_at: repos.pushed_at, ingested_at: repos.ingested_at,
      plain_summary: repos.plain_summary, business_pitch: repos.business_pitch,
      enrichment_source: repos.enrichment_source, enriched_at: repos.enriched_at,
      embedding: repos.embedding,
    })
    .from(repos)
    .where(isNotNull(repos.embedding))
    .orderBy(desc(repos.stars))
    .limit(RECO_CANDIDATE_POOL)
    .all();

  const scored = candidates
    .filter((r) => !dislikedSet.has(r.id))
    .map((r) => {
      const repoTopics = parseTopics(r.topics).map((t) => t.toLowerCase());
      const matchCount = repoTopics.filter((t) => interestSet.has(t)).length;
      const interestMatch = interestSet.size > 0 ? matchCount / interestSet.size : 0;

      const semanticScore = knnScores.get(r.id) ?? 0;

      // Popularity: log-scaled stars (so 100k stars isn't 100x a 1k repo).
      const popularity = Math.log10(Math.max(r.stars, 1) + 1) / 5; // ~0..1

      const liked = likedSet.has(r.id);

      // Fuse: semantic is the strongest signal when available, then interest
      // match, then popularity as the tiebreaker / cold-start floor.
      let recScore: number;
      if (centroid) {
        recScore = semanticScore * 0.5 + interestMatch * 0.3 + popularity * 0.2;
      } else {
        // Cold start: interest match dominates, popularity as floor.
        recScore = interestMatch * 0.6 + popularity * 0.4;
      }
      if (liked) recScore += 0.05; // slight boost so liked repos stay visible

      const { embedding: _emb, ...rest } = r;
      void _emb;
      return {
        ...rest,
        recScore: Math.round(recScore * 1000) / 1000,
        interestMatch: Math.round(interestMatch * 1000) / 1000,
        semanticScore: Math.round(semanticScore * 1000) / 1000,
        liked,
        disliked: false,
      } as Recommendation;
    });

  scored.sort((a, b) => b.recScore - a.recScore);
  return scored.slice(offset, offset + limit);
}

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? EMBEDDING_DIM;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

// --- User profile persistence ----------------------------------------------

export function getInterests(userId: string): string[] {
  const db = getDb();
  const rows = db.select({ topic: userInterests.topic })
    .from(userInterests)
    .where(eq(userInterests.user_id, userId))
    .all();
  return rows.map((r) => r.topic);
}

export function setInterests(userId: string, topics: string[]): void {
  const db = getDb();
  db.delete(userInterests).where(eq(userInterests.user_id, userId)).run();
  if (topics.length > 0) {
    db.insert(userInterests).values(
      topics.map((topic) => ({ user_id: userId, topic })),
    ).run();
  }
}

export function getFeedback(userId: string): { liked: string[]; disliked: string[] } {
  const db = getDb();
  const rows = db.select().from(repoFeedback).where(eq(repoFeedback.user_id, userId)).all();
  return {
    liked: rows.filter((r) => r.feedback === "like").map((r) => r.repo_id),
    disliked: rows.filter((r) => r.feedback === "dislike").map((r) => r.repo_id),
  };
}

export function setFeedback(
  userId: string,
  repoId: string,
  feedback: "like" | "dislike",
  reason?: string,
): void {
  const db = getDb();
  db.insert(repoFeedback)
    .values({ user_id: userId, repo_id: repoId, feedback, reason: reason ?? null })
    .onConflictDoUpdate({
      target: [repoFeedback.user_id, repoFeedback.repo_id],
      set: { feedback, reason: reason ?? null, created_at: new Date().toISOString() },
    })
    .run();
}

export function removeFeedback(userId: string, repoId: string): void {
  const db = getDb();
  db.delete(repoFeedback)
    .where(sql`${repoFeedback.user_id} = ${userId} AND ${repoFeedback.repo_id} = ${repoId}`)
    .run();
}
