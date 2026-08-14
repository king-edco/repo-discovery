import { pipeline, env } from "@huggingface/transformers";

// Use the local cache and don't try to fetch models from a remote HF hub
// in environments without network access. Models are downloaded on first use
// and cached under .cache/huggingface by default.
env.allowLocalModels = false;

// Multilingual model (intfloat/multilingual-e5-small via the Xenova ONNX mirror)
// chosen for cross-lingual alignment: a French query surfaces repos documented
// only in English. Output dim is 384 — same as the previous all-MiniLM-L6-v2,
// so no SQLite schema migration is needed. We load the q8-quantized ONNX weight
// for a smaller download and faster CPU inference.
const MODEL_ID = "Xenova/multilingual-e5-small";

// E5 models are trained with a task prefix on every input: "query: " for search
// queries, "passage: " for the documents being indexed. Omitting the prefix
// degrades retrieval quality significantly, so embedQuery/embedPassage apply it
// and must be used at the matching call site (search vs ingestion).
const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

export type Embedder = {
  /** Raw embedding of `text` with no E5 task prefix applied. */
  embed: (text: string) => Promise<number[]>;
  /** Embed a search query (prepends the E5 "query: " prefix). */
  embedQuery: (text: string) => Promise<number[]>;
  /** Embed an indexed document (prepends the E5 "passage: " prefix). */
  embedPassage: (text: string) => Promise<number[]>;
};

let embedderPromise: Promise<Embedder> | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const extractor = await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
      });
      async function embed(text: string): Promise<number[]> {
        if (!text.trim()) return [];
        const output = await extractor(text, {
          pooling: "mean",
          normalize: true,
        });
        return Array.from(output.data as Float32Array);
      }
      return {
        embed,
        embedQuery: (text: string) => embed(QUERY_PREFIX + text),
        embedPassage: (text: string) => embed(PASSAGE_PREFIX + text),
      };
    })();
  }
  return embedderPromise;
}

/**
 * Cosine similarity between two vectors in [-1, 1].
 * Vectors produced by the embedder are L2-normalized, so this reduces to a
 * dot product; we still guard against zero-length inputs and tiny float drift.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
