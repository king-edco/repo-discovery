import { getDb } from "@/db";
import { demandSignals, marketCompetitors, repos, type DemandSignal, type MarketCompetitor, type Repo } from "@/db/schema";
import {
  distanceToCosine,
  knnCompetitors,
  knnDemandSignals,
  knnRepos,
  type VectorHit,
} from "@/lib/vector-db";
import { buildFtsQuery, ftsSearchCompetitors, ftsSearchDemandSignals, ftsSearchRepos } from "@/lib/fts";

// --- Hybrid search: vector KNN + FTS5 BM25, fused by Reciprocal Rank Fusion
//
// Pure cosine similarity over embeddings is smooth and semantic but blurs
// exact terminology: a signal that names the precise technical term a repo is
// about can be ranked below a merely-topical neighbour. FTS5 BM25 captures
// exact lexical matches the embedding smooths over. Fusing the two ranked
// lists with RRF (k=60, the value from the original RRF paper) is more robust
// than either alone: a result that is strong in BOTH channels rises to the
// top, while a result strong in only one (an exact term FTS hit, or a semantic
// neighbour with no shared words) is still surfaced.

export const RRF_K = 60;
export const DEFAULT_CANDIDATES = 20; // top-k pulled from each channel
export const DEFAULT_TOP_N = 10; // results returned after fusion

// Noise gate. A candidate is admitted only if it clears at least ONE channel's
// relevance floor — this rejects deep-tail noise from both lists while still
// admitting:
//   - exact-term FTS matches the vector channel ranked low (lexical capture)
//   - semantic vector matches FTS missed (no shared words)
// The cosine floor is RELAXED vs the old 0.75 pure-cosine threshold because
// RRF now does the ranking: a 0.55 semantic neighbour that also matches FTS
// is a better result than the old pipeline would have shown at 0.75 alone.
export const VECTOR_COSINE_FLOOR = 0.5;

export type MatchChannel = "vector" | "fts" | "both";

export type RepoSearchHit = Omit<Repo, "embedding"> & {
  similarity: number; // cosine to the query (for display + the "% pertinent" UI)
  rrfScore: number;
  matchedBy: MatchChannel;
};

export type DemandSignalMatch = Omit<DemandSignal, "embedding"> & {
  similarity: number; // cosine to the repo embedding
  rrfScore: number;
  matchedBy: MatchChannel;
};

// --- RRF core -------------------------------------------------------------

type RankEntry = { id: string; rank: number };
type ChannelResult = { channel: "vector" | "fts"; ranked: RankEntry[] };

/**
 * Reciprocal Rank Fusion. For each candidate id appearing in any channel's
 * ranked list, score = Σ 1/(k + rank) over the channels it appears in
 * (1-indexed ranks). Returns ids sorted by score descending.
 */
function rrfFuse(channels: ChannelResult[], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (const { ranked } of channels) {
    ranked.forEach((entry, i) => {
      const rank = i + 1;
      const contribution = 1 / (k + rank);
      scores.set(entry.id, (scores.get(entry.id) ?? 0) + contribution);
    });
  }
  return scores;
}

// --- Demand-signal matching (repo -> demand signals) ---------------------

/**
 * Find demand signals related to a repo via hybrid vector + FTS search.
 *
 * Vector channel: KNN over demand_vectors for the repo's embedding (the repo
 * and signals share the e5 "passage:" vector space), cosine via distanceToCosine.
 * FTS channel: BM25 over demand_signals_fts for a query built from the repo's
 *   name + topics + significant description words — i.e. the repo's defining
 *   vocabulary, so lexical matches surface signals that name the same tech.
 *
 * Noise gate: a signal is admitted only if it clears VECTOR_COSINE_FLOOR on
 * the vector channel OR appears in the FTS top-k (FTS only returns docs that
 * actually contain the query terms, so any FTS hit is a genuine lexical match).
 */
export function findRelatedDemandSignals(
  repo: Pick<Repo, "id" | "name" | "full_name" | "description" | "topics">,
  repoEmbedding: number[] | null,
  opts: {
    candidates?: number;
    topN?: number;
  } = {},
): DemandSignalMatch[] {
  const candidates = opts.candidates ?? DEFAULT_CANDIDATES;
  const topN = opts.topN ?? DEFAULT_TOP_N;

  // --- vector channel ---
  const vectorHits: (VectorHit & { cosine: number })[] =
    repoEmbedding && repoEmbedding.length > 0
      ? knnDemandSignals(repoEmbedding, candidates).map((h) => ({
          ...h,
          cosine: distanceToCosine(h.distance),
        }))
      : [];
  const vectorById = new Map(vectorHits.map((h) => [h.id, h]));

  // --- FTS channel: query from the repo's defining vocabulary ---
  const ftsQueryText = buildRepoFtsQuery(repo);
  const ftsHits = ftsSearchDemandSignals(ftsQueryText, candidates);
  const ftsById = new Map(ftsHits.map((h) => [h.id, h]));

  // --- noise gate: admit if vector cosine >= floor OR present in FTS top-k ---
  const admitted = new Set<string>();
  for (const h of vectorHits) {
    if (h.cosine >= VECTOR_COSINE_FLOOR) admitted.add(h.id);
  }
  for (const h of ftsHits) admitted.add(h.id);
  if (admitted.size === 0) return [];

  // --- RRF fusion (only over admitted candidates) ---
  // Rank = 1-indexed position within each channel's filtered list.
  const channels: ChannelResult[] = [
    {
      channel: "vector",
      ranked: vectorHits
        .filter((h) => admitted.has(h.id))
        .map((h, i) => ({ id: h.id, rank: i + 1 })),
    },
  ];
  if (ftsHits.length > 0) {
    channels.push({
      channel: "fts",
      ranked: ftsHits
        .filter((h) => admitted.has(h.id))
        .map((h, i) => ({ id: h.id, rank: i + 1 })),
    });
  }
  const scores = rrfFuse(channels, RRF_K);

  // Order admitted ids by RRF score desc, take topN.
  const ordered = [...admitted]
    .map((id) => ({ id, score: scores.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (ordered.length === 0) return [];

  // --- hydrate from the canonical demand_signals table ---
  const db = getDb();
  const ids = ordered.map((o) => o.id);
  const rows = db
    .select()
    .from(demandSignals)
    .all()
    .filter((r) => ids.includes(r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results: DemandSignalMatch[] = [];
  for (const o of ordered) {
    const row = byId.get(o.id);
    if (!row) continue;
    const vec = vectorById.get(o.id);
    const inFts = ftsById.has(o.id);
    const inVec = !!vec;
    const matchedBy: MatchChannel = inVec && inFts ? "both" : inFts ? "fts" : "vector";
    // similarity for display: use the vector cosine when available; for FTS-only
    // matches compute cosine from the stored JSON (cheap, <= topN docs).
    let similarity = vec?.cosine ?? 0;
    if (!inVec && row.embedding) {
      try {
        const sigVec = JSON.parse(row.embedding) as number[];
        if (repoEmbedding && sigVec.length === repoEmbedding.length) {
          similarity = cosineDot(repoEmbedding, sigVec);
        }
      } catch {
        /* keep similarity 0 */
      }
    }
    const { embedding: _emb, ...rest } = row;
    void _emb;
    results.push({ ...rest, similarity, rrfScore: o.score, matchedBy });
  }
  return results;
}

// --- Repo search (user query -> repos) -----------------------------------

/**
 * Search repos for a free-text user query via hybrid vector + FTS.
 *
 * Vector channel: KNN over repo_vectors for embedQuery(query).
 * FTS channel: BM25 over repos_fts for the same query (quoted tokens).
 * Noise gate: admit if vector cosine >= floor OR present in FTS top-k.
 */
export function searchRepos(
  queryVec: number[],
  queryText: string,
  opts: {
    candidates?: number;
    topN?: number;
    minStars?: number | null;
  } = {},
): RepoSearchHit[] {
  const candidates = opts.candidates ?? DEFAULT_CANDIDATES;
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const minStars = opts.minStars ?? null;

  // --- vector channel ---
  const vectorHits = knnRepos(queryVec, candidates).map((h) => ({
    ...h,
    cosine: distanceToCosine(h.distance),
  }));
  const vectorById = new Map(vectorHits.map((h) => [h.id, h]));

  // --- FTS channel ---
  const ftsQuery = buildFtsQuery(queryText);
  const ftsHits = ftsSearchRepos(ftsQuery, candidates);
  const ftsById = new Map(ftsHits.map((h) => [h.id, h]));

  // --- noise gate ---
  const admitted = new Set<string>();
  for (const h of vectorHits) {
    if (h.cosine >= VECTOR_COSINE_FLOOR) admitted.add(h.id);
  }
  for (const h of ftsHits) admitted.add(h.id);
  if (admitted.size === 0) return [];

  // --- RRF fusion ---
  const channels: ChannelResult[] = [
    {
      channel: "vector",
      ranked: vectorHits
        .filter((h) => admitted.has(h.id))
        .map((h, i) => ({ id: h.id, rank: i + 1 })),
    },
  ];
  if (ftsHits.length > 0) {
    channels.push({
      channel: "fts",
      ranked: ftsHits
        .filter((h) => admitted.has(h.id))
        .map((h, i) => ({ id: h.id, rank: i + 1 })),
    });
  }
  const scores = rrfFuse(channels, RRF_K);

  const ordered = [...admitted]
    .map((id) => ({ id, score: scores.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (ordered.length === 0) return [];

  // --- hydrate from repos ---
  const db = getDb();
  const ids = ordered.map((o) => o.id);
  const rows = db
    .select()
    .from(repos)
    .all()
    .filter((r) => ids.includes(r.id)) as Repo[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results: RepoSearchHit[] = [];
  for (const o of ordered) {
    const row = byId.get(o.id);
    if (!row) continue;
    const vec = vectorById.get(o.id);
    const inFts = ftsById.has(o.id);
    const inVec = !!vec;
    const matchedBy: MatchChannel = inVec && inFts ? "both" : inFts ? "fts" : "vector";
    let similarity = vec?.cosine ?? 0;
    if (!inVec && row.embedding) {
      try {
        const repoVec = JSON.parse(row.embedding) as number[];
        if (queryVec.length === repoVec.length) similarity = cosineDot(queryVec, repoVec);
      } catch {
        /* keep 0 */
      }
    }
    const { embedding: _emb, ...rest } = row;
    void _emb;
    // Apply the minStars filter after fusion so the index still sees the full
    // candidate pool (a low-star repo can still be a valid lexical/semantic hit).
    if (minStars !== null && rest.stars < minStars) continue;
    results.push({ ...rest, similarity, rrfScore: o.score, matchedBy });
  }
  return results;
}

// --- Competitor matching (repo -> commercial competitors) -----------------
//
// Same hybrid philosophy as demand-signal matching: sqlite-vec KNN over the
// shared e5 space finds the closest commercial products to a repo's embedding,
// and FTS5 surfaces lexical matches on competitor name/description/category.
// This works for ANY repo without category wiring — the repo's embedding
// alone defines its position in the product space.

export const DEFAULT_COMPETITOR_TOP_N = 5;
// Competitors are commercial products, so the noise floor is slightly higher
// than demand signals: a weak semantic neighbour that isn't a real competitor
// adds noise to the "competitive landscape" UI.
export const COMPETITOR_COSINE_FLOOR = 0.45;

export type CompetitorMatch = Omit<MarketCompetitor, "embedding"> & {
  similarity: number; // cosine to the repo embedding
  rrfScore: number;
  matchedBy: MatchChannel;
};

/**
 * Find commercial competitors for a repo via hybrid vector + FTS search over
 * `market_competitors`. Vector channel: KNN over competitor_vectors for the
 * repo's embedding. FTS channel: BM25 over competitors_fts for a query built
 * from the repo's name + topics + description. Returns the top-N competitors
 * above the noise gate, each with a `matchedBy` provenance.
 */
export function findCompetitors(
  repo: Pick<Repo, "id" | "name" | "full_name" | "description" | "topics">,
  repoEmbedding: number[] | null,
  opts: { candidates?: number; topN?: number } = {},
): CompetitorMatch[] {
  const candidates = opts.candidates ?? DEFAULT_CANDIDATES;
  const topN = opts.topN ?? DEFAULT_COMPETITOR_TOP_N;

  // --- vector channel ---
  const vectorHits: (VectorHit & { cosine: number })[] =
    repoEmbedding && repoEmbedding.length > 0
      ? knnCompetitors(repoEmbedding, candidates).map((h) => ({
          ...h,
          cosine: distanceToCosine(h.distance),
        }))
      : [];
  const vectorById = new Map(vectorHits.map((h) => [h.id, h]));

  // --- FTS channel ---
  const ftsQueryText = buildRepoFtsQuery(repo);
  const ftsHits = ftsSearchCompetitors(ftsQueryText, candidates);
  const ftsById = new Map(ftsHits.map((h) => [h.id, h]));

  // --- noise gate ---
  const admitted = new Set<string>();
  for (const h of vectorHits) {
    if (h.cosine >= COMPETITOR_COSINE_FLOOR) admitted.add(h.id);
  }
  for (const h of ftsHits) admitted.add(h.id);
  if (admitted.size === 0) return [];

  // --- RRF fusion ---
  const channels: ChannelResult[] = [
    {
      channel: "vector",
      ranked: vectorHits
        .filter((h) => admitted.has(h.id))
        .map((h, i) => ({ id: h.id, rank: i + 1 })),
    },
  ];
  if (ftsHits.length > 0) {
    channels.push({
      channel: "fts",
      ranked: ftsHits
        .filter((h) => admitted.has(h.id))
        .map((h, i) => ({ id: h.id, rank: i + 1 })),
    });
  }
  const scores = rrfFuse(channels, RRF_K);

  const ordered = [...admitted]
    .map((id) => ({ id, score: scores.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (ordered.length === 0) return [];

  // --- hydrate ---
  const db = getDb();
  const ids = ordered.map((o) => o.id);
  const rows = db
    .select()
    .from(marketCompetitors)
    .all()
    .filter((r) => ids.includes(r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results: CompetitorMatch[] = [];
  for (const o of ordered) {
    const row = byId.get(o.id);
    if (!row) continue;
    const vec = vectorById.get(o.id);
    const inFts = ftsById.has(o.id);
    const inVec = !!vec;
    const matchedBy: MatchChannel = inVec && inFts ? "both" : inFts ? "fts" : "vector";
    let similarity = vec?.cosine ?? 0;
    if (!inVec && row.embedding) {
      try {
        const compVec = JSON.parse(row.embedding) as number[];
        if (repoEmbedding && compVec.length === repoEmbedding.length) {
          similarity = cosineDot(repoEmbedding, compVec);
        }
      } catch {
        /* keep 0 */
      }
    }
    const { embedding: _emb, ...rest } = row;
    void _emb;
    results.push({ ...rest, similarity, rrfScore: o.score, matchedBy });
  }
  return results;
}

// --- Commercial potential score -------------------------------------------
//
// On-demand (never stored): combines three axes into a single 0–100 score.
//   1. Demand intensity   = count of demand signals matched above the noise
//                            gate × the mean RRF score of those signals.
//   2. License weight     = 1.0 MIT/Apache/BSD/ISC, 0.5 MPL/LGPL, 0.1 GPL/AGPL,
//                            0.1 proprietary/none (commercial monetization is
//                            hardest under copyleft or unknown licensing).
//   3. Saturation factor  = gently raises the score when few/no competitors
//                            exist (open market) and lowers it when many close
//                            competitors are found (crowded market).
// The raw product is normalized to 0–100 with a log-ish curve so a repo with
// strong demand + permissive license + few competitors tops the scale.

export type CommercialScore = {
  score: number; // 0–100
  demandCount: number;
  /** Mean cosine similarity of the matched demand signals (quality of match). */
  meanCosine: number;
  licenseWeight: number;
  saturationFactor: number;
  competitorCount: number;
  components: {
    demand: number;
    license: number;
    saturation: number;
  };
};

// SPDX-ish license tokens map to a commercial-friendliness weight. We match
// case-insensitively against the repo's license string (GitHub returns SPDX
// ids like "MIT", "Apache-2.0", "GPL-3.0", or null).
function licenseWeight(license: string | null | undefined): number {
  if (!license) return 0.1; // unknown — treat conservatively
  const l = license.toLowerCase();
  // Permissive: full weight.
  if (/\b(mit|apache|bsd|isc|unlicense|0bsd)\b/.test(l)) return 1.0;
  // Weak copyleft / file-level: half weight (commercial use possible).
  if (/\b(mpl|lgpl|epl|cddl)\b/.test(l)) return 0.5;
  // Strong copyleft / proprietary: minimal weight.
  return 0.1; // gpl, agpl, proprietary, etc.
}

/**
 * Compute the commercial-potential score for a repo. On-demand: pulls the
 * matched demand signals + competitors via the hybrid search layers and folds
 * the three axes into a single 0–100 score. Cheap enough for per-request use
 * at current volumes; the score is NOT stored (recomputed on demand).
 */
export function computeCommercialScore(
  repo: Pick<Repo, "id" | "name" | "full_name" | "description" | "topics" | "license">,
  repoEmbedding: number[] | null,
  opts: { demandCandidates?: number; demandTopN?: number; competitorTopN?: number } = {},
): CommercialScore {
  // Use a larger candidate window for scoring so the noise gate — not an
  // arbitrary cap — decides how many signals count. DEFAULT_TOP_N (10) would
  // saturate for any repo with ≥10 matches, flattening the score.
  const demandMatches = findRelatedDemandSignals(repo, repoEmbedding, {
    candidates: opts.demandCandidates ?? DEFAULT_CANDIDATES,
    topN: opts.demandTopN ?? 30,
  });
  const competitors = findCompetitors(repo, repoEmbedding, {
    candidates: DEFAULT_CANDIDATES,
    topN: opts.competitorTopN ?? DEFAULT_COMPETITOR_TOP_N,
  });

  const demandCount = demandMatches.length;
  // Demand intensity = sum of cosine similarities of matched signals. This
  // captures both quantity AND quality: 10 strong matches (0.75) outscore
  // 10 weak ones (0.55), which count×meanRrf flattened.
  const meanCosine =
    demandCount > 0
      ? demandMatches.reduce((s, m) => s + m.similarity, 0) / demandCount
      : 0;
  const demandIntensity = demandCount * meanCosine;
  const licWeight = licenseWeight(repo.license);
  const competitorCount = competitors.length;
  // Mean competitor cosine: how close the nearest competitors are. High mean
  // = crowded market (direct competitors exist); low = open niche.
  const meanCompCosine =
    competitorCount > 0
      ? competitors.reduce((s, c) => s + c.similarity, 0) / competitorCount
      : 0;

  // Saturation: starts at 1.15 (open market). Each competitor trims ~4%, and
  // strong proximity (mean cosine) trims further — a market with 5 direct
  // competitors (0.85 cosine) is far more crowded than 5 weak ones (0.50).
  // Bottoms at 0.6 so the score never collapses to zero from saturation alone.
  const saturationFactor = Math.max(
    0.6,
    1.15 - competitorCount * 0.04 - Math.max(0, meanCompCosine - 0.5) * 0.3,
  );

  const raw = demandIntensity * licWeight * saturationFactor;

  // Normalize to 0–100 with a sqrt curve: rewards having ANY signal but needs
  // a lot of strong signals to max out. Clamped.
  const score = Math.min(100, Math.round(Math.sqrt(raw) * 22));

  return {
    score,
    demandCount,
    meanCosine,
    licenseWeight: licWeight,
    saturationFactor,
    competitorCount,
    components: {
      demand: Math.round(demandIntensity * 10) / 10,
      license: licWeight,
      saturation: Math.round(saturationFactor * 100) / 100,
    },
  };
}

// --- helpers --------------------------------------------------------------

/** Cosine of two L2-normalized vectors (= dot product). */
function cosineDot(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Build the FTS query for a repo's "demand signal" search from the repo's
 * defining vocabulary: name tokens, topics, and significant description words.
 * We drop generic stop-words and very short tokens so the FTS channel targets
 * the repo's actual technical terms (e.g. "chess", "typescript", "transformers",
 * "machine learning") rather than boilerplate.
 */
function buildRepoFtsQuery(repo: {
  name: string;
  description: string | null;
  topics: string;
}): string | null {
  const tokens = new Set<string>();
  const add = (s: string) => {
    for (const t of (s.match(/[\p{L}\p{N}]+/gu) ?? [])) {
      if (t.length <= 2) continue;
      if (STOPWORDS.has(t.toLowerCase())) continue;
      tokens.add(t);
    }
  };
  add(repo.name);
  if (repo.description) add(repo.description);
  try {
    const topics = JSON.parse(repo.topics) as string[];
    if (Array.isArray(topics)) for (const t of topics) add(t);
  } catch {
    /* ignore */
  }
  if (tokens.size === 0) return null;
  return [...tokens].map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "are",
  "not", "but", "has", "have", "was", "were", "will", "can", "all", "any",
  "into", "via", "using", "use", "used", "based", "library", "tool", "tools",
  "app", "application", "code", "project", "simple", "easy", "fast", "lightweight",
  "framework", "package", "module", "open", "source", "software", "build",
  "building", "built", "make", "made", "using", "allows", "allow", "provides",
  "provide", "support", "supports", "create", "creates", "creating", "create",
  "new", "old", "one", "two", "three", "etc", "more", "most", "very", "also",
]);
