import { eq, inArray, sql, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { repos, userInterests, repoFeedback, type Repo } from "@/db/schema";
import { knnRepos, distanceToCosine, decodeJsonEmbedding, EMBEDDING_DIM } from "@/lib/vector-db";
import { cosineSimilarity, getEmbedder } from "@/lib/embeddings";
import { parseTopics } from "@/lib/format";

// --- Recommendation engine (filter-first, profile-driven) ------------------
//
// The old engine ranked the GLOBAL top-200-by-stars pool for every user, so
// interests could never change WHICH repos were considered — only their order
// within the same famous-dev set. This version inverts the pipeline:
//
//   1. PROFILE: build a user profile from declared interests + likes − dislikes.
//      The interest keywords are embedded ONCE as an e5 query ("query: music
//      production guitar") and blended with the centroid of liked-repo
//      embeddings. Disliked repos' topics contribute NEGATIVE weight. This is
//      a semantic profile, so "music" also matches repos tagged "audio" or
//      "synthesizer" — it survives vocabulary mismatch.
//   2. POOL (filter): candidates are drawn FROM the profile — interest-topic
//      matches (SQL) ∪ KNN neighbors of the profile vector ∪ neighbors of
//      liked repos. Plus a popularity floor so cold start has material.
//   3. RANK: semantic (0.5) + topic match per-repo with diminishing returns
//      (0.25) + log-popularity (0.15) + freshness (0.10) − dislike penalty.
//   4. DIVERSITY (MMR): re-rank so a page isn't 24 near-identical repos.
//   5. EXPLORE: ~20% of the page is popular/random repos OUTSIDE the profile
//      for discovery (explore/exploit, epsilon-greedy).
//
// The pool is per-user, per-request — two users with different interests get
// fundamentally different repos, not the same list re-ordered.

const PROFILE_POOL_SIZE = 200;
const EXPLORE_POOL_SIZE = 60;
const KNN_K = 80;
const EXPLORE_RATIO = 0.2;
const MMR_LAMBDA = 0.72; // relevance vs diversity trade-off (higher = more relevance)
const LIKE_TOPIC_WEIGHT = 0.5; // implicit interests from liked repos' topics
const DISLIKE_TOPIC_PENALTY = 0.6; // down-weight topics the user disliked

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

type PoolRow = {
  id: string;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  license: string | null;
  readme_text: string | null;
  topics: string | null;
  pushed_at: string;
  ingested_at: string;
  plain_summary: string | null;
  business_pitch: string | null;
  enrichment_source: string | null;
  enriched_at: string | null;
  embedding: string | null;
};

// Embed the user's interest keywords once per request and cache on the
// embedder so a page of pagination reuses it (the embedding call is the
// expensive part of a recommend request).
const interestVecCache = new Map<string, { vec: number[]; at: number }>();
const INTEREST_VEC_TTL = 5 * 60 * 1000;

async function interestVector(interests: string[]): Promise<number[] | null> {
  if (interests.length === 0) return null;
  const key = interests.join(",");
  const hit = interestVecCache.get(key);
  if (hit && Date.now() - hit.at < INTEREST_VEC_TTL) return hit.vec;
  try {
    const embedder = await getEmbedder();
    // Humanize the tags into a query sentence: "music-production, guitar" →
    // "music production guitar". E5 "query:" prefix matches retrieval intent.
    const sentence = interests.map((t) => t.replace(/-/g, " ")).join(" ");
    const vec = await embedder.embedQuery(sentence);
    if (vec.length === EMBEDDING_DIM) {
      interestVecCache.set(key, { vec, at: Date.now() });
      return vec;
    }
  } catch {
    /* embedder unavailable — fall back to topic-only matching */
  }
  return null;
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

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const x of vec) norm += x * x;
  if (norm === 0) return vec;
  const inv = 1 / Math.sqrt(norm);
  return vec.map((x) => x * inv);
}

// Blend two normalized vectors with a weight, re-normalized.
function blend(a: number[], b: number[], wA: number, wB: number): number[] {
  const dim = a.length;
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) out[i] = a[i] * wA + b[i] * wB;
  return normalize(out);
}

const REPO_SELECT = {
  id: repos.id, name: repos.name, full_name: repos.full_name,
  description: repos.description, url: repos.url, stars: repos.stars,
  language: repos.language, license: repos.license, readme_text: repos.readme_text,
  topics: repos.topics, pushed_at: repos.pushed_at, ingested_at: repos.ingested_at,
  plain_summary: repos.plain_summary, business_pitch: repos.business_pitch,
  enrichment_source: repos.enrichment_source, enriched_at: repos.enriched_at,
  embedding: repos.embedding,
} as const;

export async function getRecommendations(params: RecommendationParams): Promise<Recommendation[]> {
  const db = getDb();
  const limit = Math.min(params.limit ?? 24, 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const { interests, likedRepoIds, dislikedRepoIds } = params;

  const interestSet = new Set(interests.map((t) => t.toLowerCase()));
  const likedSet = new Set(likedRepoIds);
  const dislikedSet = new Set(dislikedRepoIds);

  // ---- 1. Profile ----------------------------------------------------------
  // Liked repos' embeddings → centroid; their topics → implicit interests.
  const likedRows = likedRepoIds.length > 0
    ? db.select({ id: repos.id, embedding: repos.embedding, topics: repos.topics })
        .from(repos)
        .where(inArray(repos.id, likedRepoIds))
        .all()
    : [];
  const likedVecs = likedRows
    .map((r) => decodeJsonEmbedding(r.embedding))
    .filter((v): v is number[] => v !== null);

  // Implicit interests from liked repos' topics (weighted into topic scoring).
  const likeTopicBoost = new Map<string, number>();
  for (const r of likedRows) {
    for (const t of parseTopics(r.topics)) {
      const lt = t.toLowerCase();
      likeTopicBoost.set(lt, (likeTopicBoost.get(lt) ?? 0) + LIKE_TOPIC_WEIGHT);
    }
  }

  // Disliked repos' topics → negative weight (down-rank similar content).
  const dislikedRows = dislikedRepoIds.length > 0
    ? db.select({ topics: repos.topics }).from(repos).where(inArray(repos.id, dislikedRepoIds)).all()
    : [];
  const dislikeTopics = new Set<string>();
  for (const r of dislikedRows) {
    for (const t of parseTopics(r.topics)) dislikeTopics.add(t.toLowerCase());
  }

  // Profile vector: interest keywords embedded as a query, blended with the
  // liked centroid. Interests dominate (0.7) since they're explicit.
  const [interestVec] = await Promise.all([interestVector(interests)]);
  const likedCentroid = likedVecs.length > 0 ? normalize(meanVector(likedVecs)) : null;
  let profileVec: number[] | null = null;
  if (interestVec && likedCentroid) profileVec = blend(interestVec, likedCentroid, 0.7, 0.3);
  else if (interestVec) profileVec = interestVec;
  else if (likedCentroid) profileVec = likedCentroid;

  // ---- 2. Candidate pool (filter-first) ------------------------------------
  const byId = new Map<string, PoolRow>();
  const semanticScoreById = new Map<string, number>();

  // 2a. KNN neighbors of the profile vector (semantic matches).
  if (profileVec) {
    for (const hit of knnRepos(profileVec, KNN_K)) {
      semanticScoreById.set(hit.id, distanceToCosine(hit.distance));
    }
  }
  // 2b. KNN neighbors of the liked centroid (more of what you liked).
  if (likedCentroid) {
    for (const hit of knnRepos(likedCentroid, Math.floor(KNN_K / 2))) {
      const cur = semanticScoreById.get(hit.id) ?? 0;
      semanticScoreById.set(hit.id, Math.max(cur, distanceToCosine(hit.distance)));
    }
  }

  // 2c. Interest-topic matches via SQL (exact tag overlap).
  const interestMatches = interests.length > 0
    ? db.select(REPO_SELECT).from(repos)
        .where(
          sql`(${sql.join(
            interests.map((t) => sql`${repos.topics} LIKE ${'%"' + t.replace(/"/g, "").toLowerCase() + '"%'}`),
            sql` OR `,
          )})`,
        )
        .orderBy(desc(repos.stars))
        .limit(PROFILE_POOL_SIZE)
        .all()
    : [];
  for (const r of interestMatches) byId.set(r.id, r as PoolRow);

  // Fetch any KNN ids not already in the pool.
  const knnIds = [...semanticScoreById.keys()].filter((id) => !byId.has(id));
  if (knnIds.length > 0) {
    const rows = db.select(REPO_SELECT).from(repos).where(inArray(repos.id, knnIds)).all();
    for (const r of rows) byId.set(r.id, r as PoolRow);
  }

  // 2d. Popularity floor: guarantees the pool is never empty on cold start
  // (no interests, no likes) and always leaves room for explore candidates.
  const popular = db.select(REPO_SELECT).from(repos)
    .orderBy(desc(repos.stars))
    .limit(PROFILE_POOL_SIZE)
    .all();
  for (const r of popular) byId.set(r.id, r as PoolRow);

  // ---- 3. Rank --------------------------------------------------------------
  const now = Date.now();
  type Scored = PoolRow & {
    recScore: number; interestMatch: number; semanticScore: number;
    vec: number[] | null;
  };

  const scored: Scored[] = [];
  for (const r of byId.values()) {
    if (dislikedSet.has(r.id)) continue;

    const repoTopics = parseTopics(r.topics).map((t) => t.toLowerCase());
    // Topic match: fraction of the repo's topics that hit the profile, with a
    // diminishing-returns cap so multi-topic repos don't dominate. Declared
    // interests count full; liked-topic boosts add; disliked topics subtract.
    let topicHits = 0;
    let topicPenalty = 0;
    for (const t of repoTopics) {
      if (interestSet.has(t)) topicHits += 1;
      else if (likeTopicBoost.has(t)) topicHits += likeTopicBoost.get(t)!;
      if (dislikeTopics.has(t)) topicPenalty += 1;
    }
    const interestMatch = repoTopics.length > 0
      ? Math.min(1, topicHits / Math.max(1, repoTopics.length) * 2)
      : 0;

    // Semantic: from KNN if present, else compute cosine against profile.
    const vec = decodeJsonEmbedding(r.embedding);
    let semanticScore = semanticScoreById.get(r.id) ?? 0;
    if (semanticScore === 0 && profileVec && vec) {
      semanticScore = Math.max(0, cosineSimilarity(profileVec, vec));
    }

    const popularity = Math.log10(Math.max(r.stars, 1) + 1) / 5; // ~0..1
    const ageDays = Math.max(0, (now - new Date(r.pushed_at).getTime()) / 86_400_000);
    const freshness = Math.exp(-ageDays / 180); // ~1 for fresh, decays over ~6 months

    let recScore =
      semanticScore * 0.5 +
      Math.min(1, interestMatch) * 0.25 +
      popularity * 0.15 +
      freshness * 0.10 -
      Math.min(0.3, topicPenalty * DISLIKE_TOPIC_PENALTY * 0.1);
    if (likedSet.has(r.id)) recScore += 0.05;

    scored.push({ ...r, recScore, interestMatch, semanticScore, vec });
  }

  // Split into profile-relevant vs explore (discovery) candidates.
  const relevant = scored.filter((s) => s.interestMatch > 0 || s.semanticScore > 0.35 || likedSet.has(s.id));
  const explore = scored.filter((s) => !relevant.includes(s));
  relevant.sort((a, b) => b.recScore - a.recScore);
  explore.sort((a, b) => b.recScore - a.recScore);

  // ---- 4. Diversity (MMR) on the relevant list ------------------------------
  const diversified = mmr(relevant, Math.ceil(limit + offset + EXPLORE_POOL_SIZE * EXPLORE_RATIO));

  // ---- 5. Compose: explore slice woven into the exploit list ----------------
  const page = interleave(diversified, explore, EXPLORE_RATIO);

  return page.slice(offset, offset + limit).map((s) => {
    const { vec: _v, embedding: _e, ...rest } = s;
    void _v; void _e;
    return {
      ...rest,
      recScore: Math.round(s.recScore * 1000) / 1000,
      interestMatch: Math.round(s.interestMatch * 1000) / 1000,
      semanticScore: Math.round(s.semanticScore * 1000) / 1000,
      liked: likedSet.has(s.id),
      disliked: false,
    } as Recommendation;
  });
}

// Maximal Marginal Relevance: greedily pick the highest-relevance item that is
// least similar to what's already picked, so the page spans the profile's
// breadth instead of collapsing onto one dense cluster.
function mmr<T extends { recScore: number; vec: number[] | null }>(items: T[], k: number): T[] {
  const picked: T[] = [];
  const remaining = [...items];
  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSim = 0;
      if (cand.vec) {
        for (const p of picked) {
          if (!p.vec) continue;
          const sim = cosineSimilarity(cand.vec, p.vec);
          if (sim > maxSim) maxSim = sim;
        }
      }
      const score = MMR_LAMBDA * cand.recScore - (1 - MMR_LAMBDA) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  return picked;
}

// Weave `explore` items into the `exploit` list at the given ratio so each
// page carries a discovery slice without dominating the personalized picks.
function interleave<T>(exploit: T[], explore: T[], exploreRatio: number): T[] {
  const out: T[] = [];
  let e = 0;
  let x = 0;
  while (e < exploit.length || x < explore.length) {
    const targetExplore = Math.round(out.length * exploreRatio);
    const currentExplore = out.filter((i) => explore.includes(i)).length;
    if (x < explore.length && currentExplore < targetExplore) {
      out.push(explore[x++]);
    } else if (e < exploit.length) {
      out.push(exploit[e++]);
    } else {
      out.push(explore[x++]);
    }
  }
  return out;
}

// --- User profile persistence (unchanged API) -------------------------------

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

/** Interest histogram across all users — drives demand-targeted ingestion. */
export function interestHistogram(): Map<string, number> {
  const db = getDb();
  const rows = db
    .select({ topic: userInterests.topic, count: sql<number>`count(*)` })
    .from(userInterests)
    .groupBy(userInterests.topic)
    .all();
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.topic, r.count);
  return out;
}
