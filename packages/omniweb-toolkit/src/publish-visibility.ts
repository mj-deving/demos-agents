export interface PublishVisibilityResult {
  attempted: true;
  visible: boolean;
  indexedVisible: boolean;
  polls: number;
  txHash?: string;
  verificationPath?: "feed" | "post_detail" | "chain";
  observedCategory?: string;
  observedBlockNumber?: number;
  lastIndexedBlock?: number;
  error?: string;
}

interface PublishVisibilityOmni {
  colony: {
    getFeed(opts: { limit: number }): Promise<any>;
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
  const deadline = now() + opts.timeoutMs;
  const textSnippet = text.slice(0, 96);
  let polls = 0;
  let lastIndexedBlock: number | undefined;
  let lastError: string | undefined;
  let chainVisible: PublishVisibilityResult | null = null;

  while (now() <= deadline) {
    polls += 1;
    const feedResult = await omni.colony.getFeed({ limit: opts.limit });
    if (feedResult?.ok) {
      const posts = Array.isArray(feedResult.data?.posts) ? feedResult.data.posts : [];
      lastIndexedBlock = typeof feedResult.data?.meta?.lastBlock === "number"
        ? feedResult.data.meta.lastBlock
        : undefined;

      const matched = posts.find((post: any) => {
        const postTxHash = post?.txHash ?? post?.tx_hash;
        const postText = post?.text ?? post?.payload?.text ?? post?.content ?? "";
        return (txHash && postTxHash === txHash) || (typeof postText === "string" && postText.includes(textSnippet));
      });

      if (matched) {
        return {
          attempted: true,
          visible: true,
          indexedVisible: true,
          polls,
          txHash: matched.txHash ?? matched.tx_hash ?? txHash,
          verificationPath: "feed",
          observedCategory: matched.category ?? matched.payload?.cat,
          observedBlockNumber: matched.blockNumber,
          lastIndexedBlock,
        };
      }
    } else {
      lastError = feedResult?.error ?? "feed_unavailable";
    }

    if (txHash && typeof omni?.colony?.getPostDetail === "function") {
      const postDetailResult = await omni.colony.getPostDetail(txHash);
      if (postDetailResult?.ok && postDetailResult.data?.post) {
        return {
          attempted: true,
          visible: true,
          indexedVisible: true,
          polls,
          txHash,
          verificationPath: "post_detail",
          observedCategory:
            (postDetailResult.data.post.payload as { cat?: string } | undefined)?.cat,
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
    txHash,
    lastIndexedBlock,
    error: lastError ?? "published_post_not_seen_via_feed_or_post_detail",
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
