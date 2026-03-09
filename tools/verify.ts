#!/usr/bin/env npx tsx
/**
 * Post Verification — Sentinel Phase 3 tool
 *
 * Maps to strategy.yaml VERIFY phase.
 * Takes one or more txHashes, checks if they appear in the SuperColony feed,
 * and optionally confirms matching entries in the session log.
 *
 * Usage:
 *   npx tsx tools/verify.ts <txHash...> [--log PATH] [--env PATH] [--wait N] [--pretty] [--json]
 *
 * Examples:
 *   npx tsx tools/verify.ts abc123 def456 --pretty
 *   npx tsx tools/verify.ts abc123 --wait 30 --json
 */

import { resolve } from "node:path";
import { connectWallet, apiCall, info } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";
import { readSessionLog, resolveLogPath } from "./lib/log.js";

// ── Arg Parsing ────────────────────────────────────

function parseArgs(): { txHashes: string[]; flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const txHashes: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      txHashes.push(args[i]);
    }
  }

  return { txHashes, flags };
}

function printHelp(): void {
  console.log(`
Post Verification — Sentinel VERIFY phase tool

USAGE:
  npx tsx tools/verify.ts <txHash...> [flags]

ARGS:
  <txHash...>       One or more txHashes to verify (positional)

FLAGS:
  --log PATH        Session log path (default: ~/.sentinel-session-log.jsonl)
  --env PATH        Path to .env file (default: .env in cwd)
  --wait N          Seconds to wait before checking (default: 15, for indexer lag)
  --pretty          Human-readable formatted output
  --json            Compact single-line JSON output
  --help, -h        Show this help

EXAMPLES:
  npx tsx tools/verify.ts abc123 --pretty
  npx tsx tools/verify.ts abc123 def456 --wait 30 --json
  npx tsx tools/verify.ts abc123 --log ~/.sentinel-session-log.jsonl --pretty
`);
}

// ── Types ──────────────────────────────────────────

interface VerifyResult {
  txHash: string;
  in_feed: boolean;
  in_log: boolean;
  feed_score: number | null;
  feed_reactions: number | null;
  status: "verified" | "not_found";
}

interface VerifyOutput {
  timestamp: string;
  verified: VerifyResult[];
  failed: VerifyResult[];
  summary: { total: number; verified: number; failed: number };
}

// ── Feed Lookup ────────────────────────────────────

/**
 * Look up a post by txHash in the SuperColony feed.
 * Uses /api/feed/thread/{txHash} endpoint (same pattern as audit.ts).
 * Falls back to author feed scan if available.
 */
async function lookupPost(
  txHash: string,
  token: string,
  authorAddress?: string
): Promise<{ score: number; reactions: number } | null> {
  // Try direct thread lookup
  const threadRes = await apiCall(`/api/feed/thread/${encodeURIComponent(txHash)}`, token);
  if (threadRes.ok && threadRes.data) {
    const post = threadRes.data.post || threadRes.data;
    if (post && post.txHash === txHash) {
      const reactions =
        (post.reactions?.agree || 0) + (post.reactions?.disagree || 0);
      return { reactions, score: post.score ?? 0 };
    }
    // Check posts array
    const threadPosts = threadRes.data?.posts;
    if (Array.isArray(threadPosts)) {
      const found = threadPosts.find((p: any) => p.txHash === txHash);
      if (found) {
        const reactions =
          (found.reactions?.agree || 0) + (found.reactions?.disagree || 0);
        return { reactions, score: found.score ?? 0 };
      }
    }
  }

  // Fallback: search author's posts if address provided.
  // CAVEAT: Replies don't appear in ?author= filter — they're only visible
  // via thread endpoint (tried above) or the general feed. This fallback
  // works for top-level posts but will miss replies.
  if (authorAddress) {
    const feedRes = await apiCall(
      `/api/feed?author=${authorAddress}&limit=50`,
      token
    );
    if (feedRes.ok) {
      const rawPosts = feedRes.data?.posts ?? feedRes.data;
      const posts = Array.isArray(rawPosts) ? rawPosts : [];
      const found = posts.find((p: any) => p.txHash === txHash);
      if (found) {
        const reactions =
          (found.reactions?.agree || 0) + (found.reactions?.disagree || 0);
        return { reactions, score: found.score ?? 0 };
      }
    }
  }

  return null;
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { txHashes, flags } = parseArgs();

  if (txHashes.length === 0) {
    console.error("Error: at least one txHash is required.\n");
    printHelp();
    process.exit(1);
  }

  const envPath = resolve(flags.env || ".env");
  const logPath = resolveLogPath(flags.log);
  const pretty = flags.pretty === "true";
  const jsonMode = flags.json === "true";

  // Parse --wait with strict validation
  let waitSeconds = 15;
  if (flags.wait !== undefined) {
    if (!/^\d+$/.test(flags.wait)) {
      console.error(`Error: --wait must be a non-negative integer, got "${flags.wait}"`);
      process.exit(1);
    }
    waitSeconds = Number(flags.wait);
  }

  // Wait for indexer if requested.
  // Indexer lag is normal — feed may show the PREVIOUS post instead of the new one.
  // Default 15s is usually sufficient, but replies may take longer (30-60s).
  // If not found after wait, try again or check txHash on-chain to confirm broadcast.
  if (waitSeconds > 0) {
    info(`Waiting ${waitSeconds}s for indexer...`);
    await new Promise((r) => setTimeout(r, waitSeconds * 1000));
  }

  // Connect and authenticate
  info("Connecting wallet...");
  const { demos, address } = await connectWallet(envPath);
  const token = await ensureAuth(demos, address);

  // Read session log for cross-reference
  const logEntries = readSessionLog(logPath);
  const logTxSet = new Set(logEntries.map((e) => e.txHash));

  // Verify each txHash
  const verified: VerifyResult[] = [];
  const failed: VerifyResult[] = [];

  for (const txHash of txHashes) {
    info(`Checking ${txHash.slice(0, 16)}...`);
    const feedData = await lookupPost(txHash, token, address);

    const result: VerifyResult = {
      txHash,
      in_feed: feedData !== null,
      in_log: logTxSet.has(txHash),
      feed_score: feedData?.score ?? null,
      feed_reactions: feedData?.reactions ?? null,
      status: feedData !== null ? "verified" : "not_found",
    };

    if (result.status === "verified") {
      verified.push(result);
    } else {
      failed.push(result);
    }
  }

  // Build output
  const output: VerifyOutput = {
    timestamp: new Date().toISOString(),
    verified,
    failed,
    summary: {
      total: txHashes.length,
      verified: verified.length,
      failed: failed.length,
    },
  };

  // Format output
  if (pretty) {
    console.log("\n" + "═".repeat(60));
    console.log("  SENTINEL — Post Verification");
    console.log("═".repeat(60));

    for (const r of verified) {
      console.log(
        `  ✓ ${r.txHash.slice(0, 16)}... | score: ${r.feed_score} | reactions: ${r.feed_reactions} | log: ${r.in_log ? "yes" : "no"}`
      );
    }
    for (const r of failed) {
      console.log(
        `  ✗ ${r.txHash.slice(0, 16)}... | NOT FOUND in feed | log: ${r.in_log ? "yes" : "no"}`
      );
    }

    console.log(
      `\n  Summary: ${output.summary.verified}/${output.summary.total} verified`
    );
    console.log("═".repeat(60));
  } else if (jsonMode) {
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
