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

export interface SocialWriteCandidate {
  txHash: string;
  author: string;
  text: string;
  category?: string;
  score?: number;
}

export interface ReactionEnvelope {
  agree: number;
  disagree: number;
  flag: number;
  myReaction?: string | null;
}

export interface TipReadback {
  totalTips: number;
  totalDem: number;
  myTip?: unknown;
}

export interface PostDetailLike {
  replies?: Array<{ txHash?: string | null } | null> | null;
}

export function selectSocialWriteCandidate(
  posts: unknown[],
  ownAddress: string,
): SocialWriteCandidate | null {
  const normalizedOwn = ownAddress.trim().toLowerCase();

  for (const post of posts) {
    if (!post || typeof post !== "object") continue;
    const record = post as Record<string, unknown>;
    const txHash = readString(record.txHash) ?? readString(record.tx_hash);
    const author = readString(record.author);
    const text =
      readString(record.text)
      ?? readNestedString(record.payload, "text")
      ?? readString(record.content)
      ?? "";

    if (!txHash || !author || !text) continue;
    if (author.trim().toLowerCase() === normalizedOwn) continue;

    return {
      txHash,
      author,
      text,
      category: readString(record.category) ?? readNestedString(record.payload, "cat") ?? undefined,
      score: typeof record.score === "number" ? record.score : undefined,
    };
  }

  return null;
}

export function normalizeReactionEnvelope(value: unknown): ReactionEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    agree: readNumber(record.agree) ?? 0,
    disagree: readNumber(record.disagree) ?? 0,
    flag: readNumber(record.flag) ?? 0,
    myReaction: readString(record.myReaction) ?? null,
  };
}

export function reactionReadbackSatisfied(
  before: ReactionEnvelope | null,
  after: ReactionEnvelope | null,
  expectedType: "agree" | "disagree" | "flag",
): boolean {
  if (!after) return false;
  if (after.myReaction === expectedType) return true;

  const beforeCount = before?.[expectedType] ?? 0;
  const afterCount = after[expectedType] ?? 0;
  return afterCount > beforeCount;
}

export function normalizeTipReadback(value: unknown): TipReadback | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    totalTips: readNumber(record.totalTips) ?? 0,
    totalDem: readNumber(record.totalDem) ?? 0,
    myTip: record.myTip,
  };
}

export function normalizeBalance(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function tipReadbackSatisfied(
  before: TipReadback | null,
  after: TipReadback | null,
  minimumSpend: number,
): boolean {
  const beforeMyTip = readNumber(before?.myTip);
  const afterMyTip = readNumber(after?.myTip);

  if (afterMyTip != null) {
    if (beforeMyTip == null) {
      if (afterMyTip > 0) return true;
    } else if (afterMyTip > beforeMyTip) {
      return true;
    }
  } else if (hasRecordedTip(after?.myTip) && !hasRecordedTip(before?.myTip)) {
    return true;
  }

  if ((after?.totalTips ?? 0) > (before?.totalTips ?? 0)) return true;
  if ((after?.totalDem ?? 0) >= (before?.totalDem ?? 0) + minimumSpend) return true;

  return false;
}

export function tipSpendObserved(
  beforeBalance: number | null,
  afterBalance: number | null,
  minimumSpend: number,
): boolean {
  if (beforeBalance == null || afterBalance == null) return false;
  return beforeBalance - afterBalance >= minimumSpend;
}

export function hasRecordedTip(value: unknown): boolean {
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return value != null;
}

export function parentThreadContainsReply(detail: PostDetailLike | null | undefined, replyTxHash: string): boolean {
  if (!detail?.replies) return false;
  return detail.replies.some((reply) => reply?.txHash === replyTxHash);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  return readString((value as Record<string, unknown>)[key]);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
