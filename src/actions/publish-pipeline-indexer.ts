import { apiCall, info } from "../lib/network/sdk.js";
import { normalizeFeedPosts } from "../lib/pipeline/feed-filter.js";

const INDEXER_CHECK_DELAYS_MS = [5000, 10000, 15000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function pollIndexerForTx(txHash: string, feedToken: string): Promise<boolean> {
  for (const delayMs of INDEXER_CHECK_DELAYS_MS) {
    info(`Indexer check in ${Math.floor(delayMs / 1000)}s for ${txHash.slice(0, 16)}...`);
    await sleep(delayMs);

    const feedRes = await apiCall("/api/feed?limit=5", feedToken);
    if (!feedRes.ok) {
      info(`Indexer check feed read failed (${feedRes.status}) for ${txHash.slice(0, 16)}...`);
      continue;
    }

    const posts = normalizeFeedPosts(feedRes.data);
    if (posts.some((post) => String((post as Record<string, unknown>)?.txHash || "") === txHash)) {
      info(`Indexer confirmed ${txHash.slice(0, 16)}... in recent feed`);
      return true;
    }
  }

  return false;
}
