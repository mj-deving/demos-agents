#!/usr/bin/env npx tsx
/**
 * HIVE Query — read-only CLI for on-chain HIVE inspection.
 *
 * Phase 5.1 tool. Chain-first: all data comes from SDK bridge (RPC),
 * optionally enriched by colony DB cache.
 *
 * Usage:
 *   npx tsx cli/hive-query.ts posts --author 0xABC [--limit 20] [--reactions] [--pretty]
 *   npx tsx cli/hive-query.ts performance --agent sentinel [--last 10]
 *   npx tsx cli/hive-query.ts engagement --agent sentinel [--last 10]
 *   npx tsx cli/hive-query.ts colony [--hours 24] [--pretty]
 *   npx tsx cli/hive-query.ts tx <txHash> [--pretty]
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { connectWallet, info, setLogAgent } from "../src/lib/network/sdk.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../src/toolkit/sdk-bridge.js";
import type { SdkBridge } from "../src/toolkit/sdk-bridge.js";
import { resolveAgentName } from "../src/lib/agent-config.js";
import type { ScanPost } from "../src/toolkit/types.js";

// ── Arg Parsing ────────────────────────────────────

interface ParsedArgs {
  subcommand: string;
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let subcommand = "";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") {
      flags.help = "true";
      continue;
    }
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (!subcommand) {
      subcommand = argv[i];
    } else {
      positional.push(argv[i]);
    }
  }

  return { subcommand, positional, flags };
}

function printHelp(): void {
  console.log(`
HIVE Query — read-only on-chain HIVE inspection

USAGE:
  npx tsx cli/hive-query.ts <subcommand> [flags]

SUBCOMMANDS:
  posts          Posts by author
  performance    Post metrics (agree/disagree ratio)
  engagement     Aggregate reaction counts per post
  colony         Activity overview (unique authors, posts/hour, top tags)
  tx             Raw transaction lookup

COMMON FLAGS:
  --agent NAME   Agent name (default: sentinel)
  --author ADDR  Author wallet address
  --limit N      Max results (default: 20)
  --last N       Last N posts to analyze (default: 10)
  --hours N      Hours to look back (default: 24)
  --pretty       Human-readable formatted output (default)
  --json         Compact JSON output
  --reactions    Include reaction counts (posts subcommand)
  --env PATH     Path to .env file (default: .env)
  --help, -h     Show this help

EXAMPLES:
  npx tsx cli/hive-query.ts posts --author 0xABC --pretty
  npx tsx cli/hive-query.ts performance --agent sentinel --last 20
  npx tsx cli/hive-query.ts colony --hours 48 --json
  npx tsx cli/hive-query.ts tx 0xDeadBeef --pretty
`);
}

// ── Handler Types ──────────────────────────────────

interface PostsOptions {
  author: string;
  limit: number;
  reactions: boolean;
  json: boolean;
}

interface PostsResult {
  posts: Array<ScanPost & { reactions: { agree: number; disagree: number } }>;
}

interface PerformanceOptions {
  author: string;
  last: number;
}

interface PerformancePost {
  txHash: string;
  text: string;
  category: string;
  agrees: number;
  disagrees: number;
  totalReactions: number;
  agreeRatio: number;
  tags?: string[];
  timestamp: number;
}

interface PerformanceResult {
  posts: PerformancePost[];
  summary: {
    totalPosts: number;
    totalAgrees: number;
    totalDisagrees: number;
    overallAgreeRatio: number;
    avgReactionsPerPost: number;
  };
}

interface EngagementPost {
  txHash: string;
  text: string;
  category: string;
  agrees: number;
  disagrees: number;
  totalReactions: number;
  timestamp: number;
}

interface EngagementResult {
  posts: EngagementPost[];
  summary: {
    totalReactions: number;
    avgReactionsPerPost: number;
    topPost: { txHash: string; reactions: number } | null;
  };
}

interface ColonyOptions {
  hours: number;
  limit: number;
}

interface ColonyResult {
  uniqueAuthors: number;
  totalPosts: number;
  postsPerHour: number;
  topTags: Array<{ tag: string; count: number }>;
  topAuthors: Array<{ author: string; count: number }>;
  periodHours: number;
}

interface TxOptions {
  txHash: string;
}

interface TxResult {
  confirmed: boolean;
  blockNumber?: number;
  from?: string;
}

// ── Handler Implementations ────────────────────────

export async function handlePosts(
  bridge: SdkBridge,
  options: PostsOptions,
): Promise<PostsResult> {
  const posts = await bridge.getHivePostsByAuthor(options.author, { limit: options.limit });

  // TODO(api-enrichment): Wire reaction counts from SuperColony API client.
  if (options.reactions && posts.length > 0) {
    return {
      posts: posts.map((p) => ({
        ...p,
        reactions: p.reactions ?? { agree: 0, disagree: 0 },
      })),
    };
  }

  return { posts: posts.map((p) => ({ ...p })) };
}

export async function handlePerformance(
  bridge: SdkBridge,
  options: PerformanceOptions,
): Promise<PerformanceResult> {
  const posts = await bridge.getHivePostsByAuthor(options.author, { limit: options.last });

  if (posts.length === 0) {
    return {
      posts: [],
      summary: {
        totalPosts: 0,
        totalAgrees: 0,
        totalDisagrees: 0,
        overallAgreeRatio: 0,
        avgReactionsPerPost: 0,
      },
    };
  }

  // TODO(api-enrichment): Wire reaction counts from SuperColony API client.
  let totalAgrees = 0;
  let totalDisagrees = 0;

  const perfPosts: PerformancePost[] = posts.map((p) => {
    const rx = p.reactions ?? { agree: 0, disagree: 0 };
    const total = rx.agree + rx.disagree;
    totalAgrees += rx.agree;
    totalDisagrees += rx.disagree;

    return {
      txHash: p.txHash,
      text: p.text,
      category: p.category,
      agrees: rx.agree,
      disagrees: rx.disagree,
      totalReactions: total,
      agreeRatio: total > 0 ? rx.agree / total : 0,
      tags: p.tags,
      timestamp: p.timestamp,
    };
  });

  const totalReactions = totalAgrees + totalDisagrees;

  return {
    posts: perfPosts,
    summary: {
      totalPosts: posts.length,
      totalAgrees,
      totalDisagrees,
      overallAgreeRatio: totalReactions > 0 ? totalAgrees / totalReactions : 0,
      avgReactionsPerPost: posts.length > 0 ? totalReactions / posts.length : 0,
    },
  };
}

export async function handleEngagement(
  bridge: SdkBridge,
  options: PerformanceOptions,
): Promise<EngagementResult> {
  const posts = await bridge.getHivePostsByAuthor(options.author, { limit: options.last });

  if (posts.length === 0) {
    return {
      posts: [],
      summary: { totalReactions: 0, avgReactionsPerPost: 0, topPost: null },
    };
  }

  // TODO(api-enrichment): Wire reaction counts from SuperColony API client.
  let totalReactions = 0;
  let topPost: { txHash: string; reactions: number } | null = null;

  const engPosts: EngagementPost[] = posts.map((p) => {
    const rx = p.reactions ?? { agree: 0, disagree: 0 };
    const total = rx.agree + rx.disagree;
    totalReactions += total;

    if (!topPost || total > topPost.reactions) {
      topPost = { txHash: p.txHash, reactions: total };
    }

    return {
      txHash: p.txHash,
      text: p.text,
      category: p.category,
      agrees: rx.agree,
      disagrees: rx.disagree,
      totalReactions: total,
      timestamp: p.timestamp,
    };
  });

  return {
    posts: engPosts,
    summary: {
      totalReactions,
      avgReactionsPerPost: posts.length > 0 ? totalReactions / posts.length : 0,
      topPost,
    },
  };
}

export async function handleColony(
  bridge: SdkBridge,
  options: ColonyOptions,
): Promise<ColonyResult> {
  const posts = await bridge.getHivePosts(options.limit);

  const cutoffMs = Date.now() - options.hours * 60 * 60 * 1000;
  const filtered = posts.filter((p) => p.timestamp >= cutoffMs);

  const authorCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const post of filtered) {
    authorCounts.set(post.author, (authorCounts.get(post.author) ?? 0) + 1);
    if (post.tags) {
      for (const tag of post.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  const topAuthors = [...authorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([author, count]) => ({ author, count }));

  const postsPerHour = options.hours > 0 ? filtered.length / options.hours : 0;

  return {
    uniqueAuthors: authorCounts.size,
    totalPosts: filtered.length,
    postsPerHour: Math.round(postsPerHour * 100) / 100,
    topTags,
    topAuthors,
    periodHours: options.hours,
  };
}

export async function handleTx(
  bridge: SdkBridge,
  options: TxOptions,
): Promise<TxResult> {
  const result = await bridge.verifyTransaction(options.txHash);

  if (!result) {
    return { confirmed: false };
  }

  return {
    confirmed: result.confirmed,
    blockNumber: result.blockNumber,
    from: result.from,
  };
}

// ── Pretty Formatters ──────────────────────────────

function prettyPrintPosts(result: PostsResult, author: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  HIVE Posts by ${author.slice(0, 16)}...`);
  console.log("=".repeat(60));

  if (result.posts.length === 0) {
    console.log("  No posts found.");
  } else {
    for (const post of result.posts) {
      const rxStr = post.reactions
        ? ` | +${post.reactions.agree} -${post.reactions.disagree}`
        : "";
      const tagsStr = post.tags?.length ? ` [${post.tags.join(", ")}]` : "";
      console.log(`  ${post.txHash.slice(0, 12)}... | ${post.category}${tagsStr}${rxStr}`);
      console.log(`    ${post.text.slice(0, 80)}${post.text.length > 80 ? "..." : ""}`);
    }
  }

  console.log(`\n  Total: ${result.posts.length} posts`);
  console.log("=".repeat(60));
}

function prettyPrintPerformance(result: PerformanceResult): void {
  console.log("\n" + "=".repeat(60));
  console.log("  HIVE Post Performance");
  console.log("=".repeat(60));

  for (const post of result.posts) {
    const pct = (post.agreeRatio * 100).toFixed(0);
    console.log(`  ${post.txHash.slice(0, 12)}... | ${pct}% agree | +${post.agrees} -${post.disagrees} (${post.totalReactions} total)`);
  }

  const { summary } = result;
  console.log(`\n  Summary: ${summary.totalPosts} posts | ${summary.totalAgrees}/${summary.totalAgrees + summary.totalDisagrees} agrees | avg ${summary.avgReactionsPerPost.toFixed(1)} rx/post`);
  console.log("=".repeat(60));
}

function prettyPrintEngagement(result: EngagementResult): void {
  console.log("\n" + "=".repeat(60));
  console.log("  HIVE Engagement Report");
  console.log("=".repeat(60));

  for (const post of result.posts) {
    console.log(`  ${post.txHash.slice(0, 12)}... | +${post.agrees} -${post.disagrees} (${post.totalReactions} total)`);
  }

  const { summary } = result;
  console.log(`\n  Total reactions: ${summary.totalReactions} | avg ${summary.avgReactionsPerPost.toFixed(1)}/post`);
  if (summary.topPost) {
    console.log(`  Top post: ${summary.topPost.txHash.slice(0, 12)}... (${summary.topPost.reactions} reactions)`);
  }
  console.log("=".repeat(60));
}

function prettyPrintColony(result: ColonyResult): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  Colony Activity (last ${result.periodHours}h)`);
  console.log("=".repeat(60));

  console.log(`  Posts: ${result.totalPosts} | Authors: ${result.uniqueAuthors} | Rate: ${result.postsPerHour}/hr`);

  if (result.topTags.length > 0) {
    console.log("\n  Top Tags:");
    for (const { tag, count } of result.topTags.slice(0, 5)) {
      console.log(`    ${tag}: ${count}`);
    }
  }

  if (result.topAuthors.length > 0) {
    console.log("\n  Top Authors:");
    for (const { author, count } of result.topAuthors.slice(0, 5)) {
      console.log(`    ${author.slice(0, 16)}...: ${count} posts`);
    }
  }

  console.log("=".repeat(60));
}

function prettyPrintTx(result: TxResult, txHash: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  Transaction: ${txHash.slice(0, 24)}...`);
  console.log("=".repeat(60));

  if (result.confirmed) {
    console.log(`  Status: CONFIRMED`);
    if (result.blockNumber !== undefined) console.log(`  Block: ${result.blockNumber}`);
    if (result.from) console.log(`  From: ${result.from}`);
  } else {
    console.log(`  Status: NOT FOUND`);
  }

  console.log("=".repeat(60));
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { subcommand, positional, flags } = parseArgs();

  if (flags.help === "true" || !subcommand) {
    printHelp();
    process.exit(0);
  }

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const envPath = resolve(flags.env || ".env");
  const jsonMode = flags.json === "true";
  const pretty = !jsonMode;
  const limit = flags.limit ? Number(flags.limit) : 20;
  const last = flags.last ? Number(flags.last) : 10;
  const hours = flags.hours ? Number(flags.hours) : 24;

  // Resolve author address — from --author flag, or connect wallet for own address
  let authorAddress = flags.author || "";

  // Connect wallet for chain access
  info("Connecting wallet...");
  const { demos, address } = await connectWallet(envPath);
  const bridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);

  // Use own address if no --author specified
  if (!authorAddress) {
    authorAddress = address;
  }

  switch (subcommand) {
    case "posts": {
      const result = await handlePosts(bridge, {
        author: authorAddress,
        limit,
        reactions: flags.reactions === "true",
        json: jsonMode,
      });
      if (pretty) prettyPrintPosts(result, authorAddress);
      else console.log(JSON.stringify(result));
      break;
    }

    case "performance": {
      const result = await handlePerformance(bridge, {
        author: authorAddress,
        last,
      });
      if (pretty) prettyPrintPerformance(result);
      else console.log(JSON.stringify(result));
      break;
    }

    case "engagement": {
      const result = await handleEngagement(bridge, {
        author: authorAddress,
        last,
      });
      if (pretty) prettyPrintEngagement(result);
      else console.log(JSON.stringify(result));
      break;
    }

    case "colony": {
      const result = await handleColony(bridge, { hours, limit: limit > 20 ? limit : 100 });
      if (pretty) prettyPrintColony(result);
      else console.log(JSON.stringify(result));
      break;
    }

    case "tx": {
      const txHash = positional[0] || flags.tx;
      if (!txHash) {
        console.error("Error: tx subcommand requires a txHash argument");
        process.exit(1);
      }
      const result = await handleTx(bridge, { txHash });
      if (pretty) prettyPrintTx(result, txHash);
      else console.log(JSON.stringify(result));
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

// Only run when invoked directly (not when imported by tests)
const isDirectRun =
  process.argv[1]?.endsWith("hive-query.ts") ||
  process.argv[1]?.endsWith("hive-query.js");

if (isDirectRun) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hive-query] ERROR: ${message}`);
    process.exit(1);
  });
}
