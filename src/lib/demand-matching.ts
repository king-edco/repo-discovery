import { isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { demandSignals, type DemandSignal } from "@/db/schema";
import { cosineSimilarity } from "@/lib/embeddings";

// Minimum cosine similarity for a demand signal to be considered a relevant
// match for a repo. Below this, results are noise — better to show nothing than
// to surface an irrelevant link. Tuned for multilingual-e5-small (passage vs
// passage, same prefix on both sides since both are "documents").
export const DEFAULT_MIN_SIMILARITY = 0.75;

export const DEFAULT_TOP_N = 10;

export type DemandSignalMatch = Omit<
  DemandSignal,
  "embedding"
> & {
  similarity: number;
};

/**
 * Find the demand signals most semantically similar to a given repo embedding.
 *
 * Both the repo and the demand signals were embedded with multilingual-e5-small
 * using the E5 "passage: " prefix, so they live in the same 384-dim vector
 * space and cosine similarity is directly meaningful. Vectors are L2-normalized
 * at embedding time, so cosine similarity reduces to a dot product; we still
 * guard against zero-length / mismatched inputs.
 *
 * Results below `minSimilarity` are dropped (returns [] rather than forcing
 * weak matches), then sorted by similarity descending and capped at `topN`.
 */
export function findRelatedDemandSignals(
  repoEmbedding: number[] | null,
  opts: {
    minSimilarity?: number;
    topN?: number;
  } = {},
): DemandSignalMatch[] {
  if (!repoEmbedding || repoEmbedding.length === 0) return [];

  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const topN = opts.topN ?? DEFAULT_TOP_N;

  const db = getDb();
  const rows = db
    .select()
    .from(demandSignals)
    .where(isNotNull(demandSignals.embedding))
    .all();

  const matches: DemandSignalMatch[] = [];
  for (const r of rows) {
    const sigVec = r.embedding ? (JSON.parse(r.embedding) as number[]) : [];
    const sim = cosineSimilarity(repoEmbedding, sigVec);
    if (sim >= minSim) {
      // Omit the raw embedding from the returned object.
      const { embedding: _embedding, ...rest } = r;
      void _embedding;
      matches.push({ ...rest, similarity: sim });
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, topN);
}
