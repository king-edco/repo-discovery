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
