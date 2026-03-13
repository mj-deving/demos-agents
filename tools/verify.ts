#!/usr/bin/env npx tsx
/**
 * Post Verification — Sentinel Phase 3 tool
 *
 * Maps to strategy.yaml VERIFY phase.
 * Takes one or more txHashes, checks if they appear in the SuperColony feed,
 * and optionally confirms matching entries in the session log.
 *
 * Usage:
 *   npx tsx tools/verify.ts [txHash...] [--log PATH] [--env PATH] [--wait N] [--pretty] [--json]
 *
 * Examples:
 *   npx tsx tools/verify.ts abc123 def456 --pretty
 *   npx tsx tools/verify.ts abc123 --wait 30 --json
 *   npx tsx tools/verify.ts --agent sentinel --pretty
 */

import { resolve } from "node:path";
import { connectWallet, apiCall, info, setLogAgent } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";
import { readSessionLog, resolveLogPath } from "./lib/log.js";
import { resolveAgentName } from "./lib/agent-config.js";

const VERIFY_RETRY_DELAYS_MS = [5000, 10000, 15000] as const;

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
  npx tsx tools/verify.ts [txHash...] [flags]

ARGS:
  [txHash...]       One or more txHashes to verify (positional)
                    If omitted, verifies the latest txHash from the session log

FLAGS:
  --agent NAME      Agent name (default: sentinel)
  --log PATH        Session log path (default: ~/.{agent}-session-log.jsonl)
  --env PATH        Path to .env file (default: .env in cwd)
  --wait N          Extra seconds to wait before retry polling starts (default: 0)
  --pretty          Human-readable formatted output
  --json            Compact single-line JSON output
  --help, -h        Show this help

EXAMPLES:
  npx tsx tools/verify.ts abc123 --pretty
  npx tsx tools/verify.ts abc123 def456 --wait 30 --json
  npx tsx tools/verify.ts --agent sentinel --pretty
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function buildVerifyRetrySchedule(initialExtraDelayMs: number): number[] {
  const schedule = [...VERIFY_RETRY_DELAYS_MS];
  if (initialExtraDelayMs > 0) {
    schedule[0] += initialExtraDelayMs;
  }
  return schedule;
}

function inferLatestTxHashes(logEntries: Array<{ txHash?: string }>): string[] {
  for (let i = logEntries.length - 1; i >= 0; i--) {
    const txHash = String(logEntries[i]?.txHash || "").trim();
    if (txHash) return [txHash];
  }
  return [];
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
  const threadRes = await apiCall(`/api/feed/thread/${encodeURIComponent(txHash)}`, token);
  if (threadRes.ok && threadRes.data) {
    const post = threadRes.data.post || threadRes.data;
    if (post && post.txHash === txHash) {
      const reactions =
        (post.reactions?.agree || 0) + (post.reactions?.disagree || 0);
      return { reactions, score: post.score ?? 0 };
    }

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

async function lookupPostWithRetries(
  txHash: string,
  token: string,
  authorAddress?: string,
  initialDelayMs: number = 0
): Promise<{ score: number; reactions: number } | null> {
  let found = await lookupPost(txHash, token, authorAddress);
  if (found) return found;

  for (const delayMs of buildVerifyRetrySchedule(initialDelayMs)) {
    info(`Verifier retry in ${Math.floor(delayMs / 1000)}s for ${txHash.slice(0, 16)}...`);
    await sleep(delayMs);
    found = await lookupPost(txHash, token, authorAddress);
    if (found) return found;
  }

  return null;
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { txHashes, flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const envPath = resolve(flags.env || ".env");
  const logPath = resolveLogPath(flags.log, agentName);
  const pretty = flags.pretty === "true";
  const jsonMode = flags.json === "true";

  let waitSeconds = 0;
  if (flags.wait !== undefined) {
    if (!/^\d+$/.test(flags.wait)) {
      console.error(`Error: --wait must be a non-negative integer, got "${flags.wait}"`);
      process.exit(1);
    }
    waitSeconds = Number(flags.wait);
  }

  info("Connecting wallet...");
  const { demos, address } = await connectWallet(envPath);
  const token = await ensureAuth(demos, address);

  const logEntries = readSessionLog(logPath);
  const logTxSet = new Set(logEntries.map((e) => e.txHash));
  const targets = txHashes.length > 0 ? txHashes : inferLatestTxHashes(logEntries);

  if (targets.length === 0) {
    console.error("Error: no txHashes provided and no txHash found in the session log.\n");
    printHelp();
    process.exit(1);
  }

  if (txHashes.length === 0) {
    info(`No txHash provided — verifying latest session log entry ${targets[0].slice(0, 16)}...`);
  }

  const verified: VerifyResult[] = [];
  const failed: VerifyResult[] = [];

  for (const txHash of targets) {
    info(`Checking ${txHash.slice(0, 16)}...`);
    const feedData = await lookupPostWithRetries(txHash, token, address, waitSeconds * 1000);

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

  const output: VerifyOutput = {
    timestamp: new Date().toISOString(),
    verified,
    failed,
    summary: {
      total: targets.length,
      verified: verified.length,
      failed: failed.length,
    },
  };

  if (pretty) {
    console.log("\n" + "═".repeat(60));
    console.log(`  ${agentName.toUpperCase()} — Post Verification`);
    console.log("═".repeat(60));

    for (const result of verified) {
      console.log(
        `  ✓ ${result.txHash.slice(0, 16)}... | score: ${result.feed_score} | reactions: ${result.feed_reactions} | log: ${result.in_log ? "yes" : "no"}`
      );
    }
    for (const result of failed) {
      console.log(
        `  ✗ ${result.txHash.slice(0, 16)}... | NOT FOUND in feed | log: ${result.in_log ? "yes" : "no"}`
      );
    }

    console.log(`\n  Summary: ${output.summary.verified}/${output.summary.total} verified`);
    console.log("═".repeat(60));
  } else if (jsonMode) {
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
