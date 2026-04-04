/**
 * Local embedding service using Hugging Face Transformers.js.
 *
 * Loads bge-small-en-v1.5 (384-dim, q8 quantized) lazily on first call.
 * Falls back gracefully when model is unavailable.
 */

type Pipeline = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float64Array; dims: number[] }>;

let pipeline: Pipeline | null = null;
let loadFailed = false;

async function getPipeline(): Promise<Pipeline | null> {
  if (loadFailed) return null;
  if (pipeline) return pipeline;

  try {
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    pipeline = await createPipeline(
      "feature-extraction",
      "Xenova/bge-small-en-v1.5",
      { dtype: "q8" },
    ) as unknown as Pipeline;
    return pipeline;
  } catch {
    loadFailed = true;
    return null;
  }
}

/**
 * Generate a 384-dim embedding for a single text string.
 * Returns null if the model is unavailable.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  const pipe = await getPipeline();
  if (!pipe) return null;

  const output = await pipe(text, { pooling: "cls", normalize: true });
  return new Float32Array(output.data);
}

/**
 * Generate embeddings for multiple texts in sequence.
 * Returns null entries for any texts that fail.
 */
export async function embedBatch(texts: string[]): Promise<Array<Float32Array | null>> {
  const pipe = await getPipeline();
  if (!pipe) return texts.map(() => null);

  const results: Array<Float32Array | null> = [];
  for (const text of texts) {
    try {
      const output = await pipe(text, { pooling: "cls", normalize: true });
      results.push(new Float32Array(output.data));
    } catch {
      results.push(null);
    }
  }
  return results;
}

/** Check if the embedding model is available (loaded or loadable). */
export function isAvailable(): boolean {
  return !loadFailed;
}

/** Reset the singleton for testing. */
export function _reset(): void {
  pipeline = null;
  loadFailed = false;
}
