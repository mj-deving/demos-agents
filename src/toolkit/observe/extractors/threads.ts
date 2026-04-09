/**
 * Threads evidence extractor.
 * Maps QUESTION-category posts to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";

const STALE_THRESHOLD_MS = 86_400_000;

export async function extractThreads(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.feedQuestions ?? await toolkit.feed.search({ text: "", category: "QUESTION", limit: 20 });
  if (!result || !result.ok) return [];
  if (!result.data?.posts) return [];

  return result.data.posts.map((post) => {
    const text = String(post.payload?.["text"] ?? "");
    const cat = String(post.payload?.["cat"] ?? "QUESTION");
    const age = Date.now() - post.timestamp;

    return {
      sourceId: `thread-${post.txHash}`,
      subject: text.slice(0, 80),
      metrics: [cat],
      richness: Math.min(95, text.length),
      freshness: Math.floor(age / 1000),
      stale: age > STALE_THRESHOLD_MS,
    };
  });
}
