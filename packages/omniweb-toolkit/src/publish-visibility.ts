export interface PublishVisibilityResult {
  attempted: true;
  visible: boolean;
  indexedVisible: boolean;
  polls: number;
  elapsedMs: number;
  txHash?: string;
  verificationPath?: "feed" | "post_detail" | "chain";
  feedScope?: "recent" | "category";
  observedCategory?: string;
  observedBlockNumber?: number;
  observedScore?: number;
  lastIndexedBlock?: number;
  error?: string;
}

interface PublishVisibilityOmni {
  colony: {
    getFeed(opts: { limit: number; category?: string }): Promise<any>;
    getPostDetail?(txHash: string): Promise<any>;
  };
  runtime?: {
    sdkBridge?: {
      getHivePosts?(limit: number): Promise<any>;
    };
  };
}

export async function verifyPublishVisibility(
  omni: PublishVisibilityOmni,
  txHash: string | undefined,
  text: string,
  opts: {
    timeoutMs: number;
    pollMs: number;
    limit: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<PublishVisibilityResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = now();
  const deadline = now() + opts.timeoutMs;
  const textSnippet = text.slice(0, 96);
  let polls = 0;
  let lastIndexedBlock: number | undefined;
  let lastError: string | undefined;
  let chainVisible: PublishVisibilityResult | null = null;

  while (now() <= deadline) {
    polls += 1;
    const recentFeedMatch = await readFeedMatch(omni, txHash, textSnippet, {
      limit: opts.limit,
    });
    if (recentFeedMatch.result?.ok) {
      lastIndexedBlock = typeof recentFeedMatch.result.data?.meta?.lastBlock === "number"
        ? recentFeedMatch.result.data.meta.lastBlock
        : undefined;
    } else if (recentFeedMatch.result) {
      lastError = recentFeedMatch.result?.error ?? "feed_unavailable";
    }

    if (recentFeedMatch.matched) {
      return {
        attempted: true,
        visible: true,
        indexedVisible: true,
        polls,
        elapsedMs: now() - startedAt,
        txHash: recentFeedMatch.matched.txHash ?? recentFeedMatch.matched.tx_hash ?? txHash,
        verificationPath: "feed",
        feedScope: "recent",
        observedCategory: recentFeedMatch.matched.category ?? recentFeedMatch.matched.payload?.cat,
        observedBlockNumber: recentFeedMatch.matched.blockNumber,
        observedScore: typeof recentFeedMatch.matched.score === "number" ? recentFeedMatch.matched.score : undefined,
        lastIndexedBlock,
      };
    }

    if (txHash && typeof omni?.colony?.getPostDetail === "function") {
      const postDetailResult = await omni.colony.getPostDetail(txHash);
      if (postDetailResult?.ok && postDetailResult.data?.post) {
        const observedCategory =
          (postDetailResult.data.post.payload as { cat?: string } | undefined)?.cat;
        if (observedCategory) {
          const categoryFeedMatch = await readFeedMatch(omni, txHash, textSnippet, {
            limit: opts.limit,
            category: observedCategory,
          });
          if (categoryFeedMatch.matched) {
            return {
              attempted: true,
              visible: true,
              indexedVisible: true,
              polls,
              elapsedMs: now() - startedAt,
              txHash: categoryFeedMatch.matched.txHash ?? categoryFeedMatch.matched.tx_hash ?? txHash,
              verificationPath: "feed",
              feedScope: "category",
              observedCategory,
              observedBlockNumber: categoryFeedMatch.matched.blockNumber ?? postDetailResult.data.post.blockNumber,
              observedScore: typeof categoryFeedMatch.matched.score === "number"
                ? categoryFeedMatch.matched.score
                : undefined,
              lastIndexedBlock,
            };
          }
        }

        return {
          attempted: true,
          visible: true,
          indexedVisible: true,
          polls,
          elapsedMs: now() - startedAt,
          txHash,
          verificationPath: "post_detail",
          observedCategory,
          observedBlockNumber: postDetailResult.data.post.blockNumber,
          lastIndexedBlock,
        };
      }
      if (!postDetailResult?.ok) {
        lastError = postDetailResult?.error ?? lastError;
      }
    }

    const bridge = omni?.runtime?.sdkBridge;
    if (txHash && typeof bridge?.getHivePosts === "function") {
      try {
        const chainPosts = await bridge.getHivePosts(Math.max(opts.limit, 50));
        const matched = Array.isArray(chainPosts)
          ? chainPosts.find((post: any) => {
              const postText = post?.text ?? "";
              return post?.txHash === txHash || (typeof postText === "string" && postText.includes(textSnippet));
            })
          : null;

        if (matched) {
          chainVisible = {
            attempted: true,
            visible: true,
            indexedVisible: false,
            polls,
            elapsedMs: now() - startedAt,
            txHash: matched.txHash ?? txHash,
            verificationPath: "chain",
            observedCategory: matched.category,
            observedBlockNumber: matched.blockNumber,
            lastIndexedBlock,
            error: lastError ?? "post_visible_on_chain_but_not_yet_indexed",
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
  }

  if (chainVisible) {
    return {
      ...chainVisible,
      polls,
      lastIndexedBlock,
      error: lastError ?? chainVisible.error,
    };
  }

  return {
    attempted: true,
    visible: false,
    indexedVisible: false,
    polls,
    elapsedMs: now() - startedAt,
    txHash,
    lastIndexedBlock,
    error: lastError ?? "published_post_not_seen_via_feed_or_post_detail",
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readFeedMatch(
  omni: PublishVisibilityOmni,
  txHash: string | undefined,
  textSnippet: string,
  opts: { limit: number; category?: string },
): Promise<{ result: any; matched: any | null }> {
  const result = await omni.colony.getFeed(opts);
  if (!result?.ok) {
    return { result, matched: null };
  }

  const posts = Array.isArray(result.data?.posts) ? result.data.posts : [];
  const matched = posts.find((post: any) => {
    const postTxHash = post?.txHash ?? post?.tx_hash;
    const postText = post?.text ?? post?.payload?.text ?? post?.content ?? "";
    return (txHash && postTxHash === txHash) || (typeof postText === "string" && postText.includes(textSnippet));
  }) ?? null;

  return { result, matched };
}
