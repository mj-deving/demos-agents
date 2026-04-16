#!/usr/bin/env npx tsx
/**
 * probe-publish.ts — explicit live publish probe for omniweb-toolkit.
 *
 * Default behavior is non-destructive: it validates the draft shape and reports
 * what would be published. Passing `--broadcast` executes a real DAHR+publish
 * flow against the live network.
 *
 * Output: JSON to stdout. Errors to stderr. Exit 0 on success, 1 on publish/runtime
 * failure, 2 on invalid args.
 */

import { validateInput, PublishDraftSchema } from "../../../src/toolkit/schemas.js";

const DEFAULT_ATTEST_URL = "https://blockchain.info/ticker";
const DEFAULT_CATEGORY = "OBSERVATION";
const DEFAULT_CONFIDENCE = 80;
const DEFAULT_TEXT =
  "Operational publish-path verification on 2026-04-15: omniweb-toolkit connect(), DAHR attestation, and HIVE publish are being exercised end-to-end against the live network. This post uses publicly verifiable BTC ticker JSON from Blockchain.info and exists only to confirm that the package write path remains functional after the recent refactor cycle.";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-publish.ts [options]

Options:
  --text TEXT          Post body to publish (default: built-in probe text)
  --category CAT       Post category (default: OBSERVATION)
  --attest-url URL     Attestation URL (default: Blockchain.info ticker JSON)
  --confidence N       Confidence value (default: 80)
  --state-dir PATH     Override state directory for guards
  --feed-timeout-ms N  How long to poll post visibility after broadcast (default: 30000)
  --feed-poll-ms N     Delay between visibility checks after broadcast (default: 3000)
  --feed-limit N       Recent feed window to scan during verification (default: 20)
  --no-verify-feed     Skip post-broadcast visibility verification
  --allow-insecure     Allow HTTP attest URLs (local dev only)
  --broadcast          Execute the real DAHR+publish flow
  --help, -h           Show this help

Output: JSON publish-probe report
Exit codes: 0 = success, 1 = runtime or publish failure, 2 = invalid args`);
  process.exit(0);
}

function getStringArg(flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

function getNumberArg(flag: string, fallback: number): number {
  const raw = getStringArg(flag, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getIntegerArg(flag: string, fallback: number): number {
  const parsed = getNumberArg(flag, fallback);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

for (const flag of ["--text", "--category", "--attest-url", "--confidence", "--state-dir", "--feed-timeout-ms", "--feed-poll-ms", "--feed-limit"]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const draft = {
  text: getStringArg("--text", DEFAULT_TEXT),
  category: getStringArg("--category", DEFAULT_CATEGORY),
  attestUrl: getStringArg("--attest-url", DEFAULT_ATTEST_URL),
  confidence: getNumberArg("--confidence", DEFAULT_CONFIDENCE),
};
const stateDirArg = getStringArg("--state-dir", "");
const stateDir = stateDirArg || undefined;
const feedTimeoutMs = getIntegerArg("--feed-timeout-ms", 30_000);
const feedPollMs = getIntegerArg("--feed-poll-ms", 3_000);
const feedLimit = getIntegerArg("--feed-limit", 20);
const verifyFeed = !args.includes("--no-verify-feed");
const allowInsecureUrls = args.includes("--allow-insecure");
const broadcast = args.includes("--broadcast");

const schemaError = validateInput(PublishDraftSchema, draft);
if (schemaError) {
  console.error(JSON.stringify({
    attempted: false,
    ok: false,
    error: {
      code: schemaError.code,
      message: schemaError.message,
      retryable: schemaError.retryable,
    },
    draft,
  }, null, 2));
  process.exit(2);
}

for (const [flag, value] of [
  ["--feed-timeout-ms", feedTimeoutMs],
  ["--feed-poll-ms", feedPollMs],
  ["--feed-limit", feedLimit],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Error: invalid ${flag} value ${value}`);
    process.exit(2);
  }
}

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir, allowInsecureUrls });

  if (!broadcast) {
    console.log(JSON.stringify({
      attempted: false,
      ok: true,
      address: omni.address,
      draft,
      message: "Dry run only. Re-run with --broadcast to execute the real DAHR+publish flow.",
    }, null, 2));
    process.exit(0);
  }

  const result = await omni.colony.publish(draft);
  if (!result.ok) {
    console.log(JSON.stringify({
      attempted: true,
      ok: false,
      address: omni.address,
      draft,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            retryable: result.error.retryable,
          }
        : { code: "UNKNOWN", message: "Unknown publish failure" },
    }, null, 2));
    process.exit(1);
  }

  const feedVerification = verifyFeed
    ? await verifyFeedVisibility(omni, result.data?.txHash, draft.text, {
        timeoutMs: feedTimeoutMs,
        pollMs: feedPollMs,
        limit: feedLimit,
      })
    : { attempted: false };
  const visibilityOk = !("attempted" in feedVerification)
    || !feedVerification.attempted
    || (!!feedVerification.visible && feedVerification.indexedVisible !== false);

  console.log(JSON.stringify({
    attempted: true,
    ok: visibilityOk,
    address: omni.address,
    draft,
    txHash: result.data?.txHash,
    provenance: result.provenance,
    feedVerification,
  }, null, 2));
  process.exit(visibilityOk ? 0 : 1);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function verifyFeedVisibility(
  omni: any,
  txHash: string | undefined,
  text: string,
  opts: { timeoutMs: number; pollMs: number; limit: number },
): Promise<{
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
}> {
  const deadline = Date.now() + opts.timeoutMs;
  const textSnippet = text.slice(0, 96);
  let polls = 0;
  let lastIndexedBlock: number | undefined;
  let lastError: string | undefined;

  while (Date.now() <= deadline) {
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
          return {
            attempted: true,
            visible: true,
            indexedVisible: false,
            polls,
            txHash: matched.txHash ?? txHash,
            verificationPath: "chain",
            observedCategory: matched.category,
            observedBlockNumber: matched.blockNumber,
            lastIndexedBlock,
            error: lastError ?? "post_visible_on_chain_but_not_via_feed_or_post_detail",
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (Date.now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConnect(): Promise<(opts?: {
  stateDir?: string;
  allowInsecureUrls?: boolean;
}) => Promise<any>> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect;
}
