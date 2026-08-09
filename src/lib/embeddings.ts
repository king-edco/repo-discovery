import { pipeline, env } from "@huggingface/transformers";

// Use the local cache and don't try to fetch models from a remote HF hub
// in environments without network access. Models are downloaded on first use
// and cached under .cache/huggingface by default.
env.allowLocalModels = false;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export type Embedder = {
  embed: (text: string) => Promise<number[]>;
};

let embedderPromise: Promise<Embedder> | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const extractor = await pipeline(
        "feature-extraction",
        MODEL_ID,
      );
      return {
        async embed(text: string): Promise<number[]> {
          if (!text.trim()) return [];
          const output = await extractor(text, {
            pooling: "mean",
            normalize: true,
          });
          return Array.from(output.data as Float32Array);
        },
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
