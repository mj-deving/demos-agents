#!/usr/bin/env npx tsx
/**
 * leaderboard-snapshot.ts — Summarize top agents and recent category mix.
 *
 * AgentSkills spec: non-interactive, structured output, --help, deterministic.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = success, 1 = fetch problem, 2 = invalid args.
 */

import {
  DEFAULT_BASE_URL,
  fetchText,
  getNumberArg,
  getStringArg,
  hasFlag,
} from "./_shared.js";

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/leaderboard-snapshot.ts [--base-url URL] [--limit N] [--feed-limit N] [--timeout-ms N]

Options:
  --base-url URL   SuperColony base URL (default: ${DEFAULT_BASE_URL})
  --limit N        Number of leaderboard agents to include (default: 10)
  --feed-limit N   Number of feed posts to sample for category mix (default: 100)
  --timeout-ms N   Request timeout in milliseconds (default: 15000)
  --help, -h       Show this help

Output: JSON snapshot of top agents, leaderboard average, and recent category mix
Exit codes: 0 = success, 1 = fetch error, 2 = invalid args`);
  process.exit(0);
}

const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;
const limit = getNumberArg(args, "--limit") ?? 10;
const feedLimit = getNumberArg(args, "--feed-limit") ?? 100;
const timeoutMs = getNumberArg(args, "--timeout-ms") ?? 15_000;

if (!Number.isInteger(limit) || limit < 1) {
  console.error("Error: --limit must be a positive integer");
  process.exit(2);
}

if (!Number.isInteger(feedLimit) || feedLimit < 1) {
  console.error("Error: --feed-limit must be a positive integer");
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("Error: --timeout-ms must be a positive number");
  process.exit(2);
}

const [leaderboardResponse, feedResponse, statsResponse] = await Promise.all([
  fetchText(`/api/scores/agents?limit=${limit}`, { baseUrl, timeoutMs, accept: "application/json" }),
  fetchText(`/api/feed?limit=${feedLimit}`, { baseUrl, timeoutMs, accept: "application/json" }),
  fetchText("/api/stats", { baseUrl, timeoutMs, accept: "application/json" }),
]);

const ok = leaderboardResponse.ok && feedResponse.ok && statsResponse.ok;

let topAgents: Array<Record<string, unknown>> = [];
let globalAvg: number | null = null;
let feedCategoryMix: Record<string, number> = {};
let statsTopCategories: Array<Record<string, unknown>> = [];

if (leaderboardResponse.ok) {
  try {
    const leaderboardJson = JSON.parse(leaderboardResponse.body) as {
      globalAvg?: number;
      agents?: Array<{
        name?: string;
        address?: string;
        bayesianScore?: number;
        avgScore?: number;
        totalPosts?: number;
      }>;
    };
    globalAvg = typeof leaderboardJson.globalAvg === "number" ? leaderboardJson.globalAvg : null;
    topAgents = (leaderboardJson.agents ?? []).map((agent) => ({
      name: agent.name ?? null,
      address: agent.address ?? null,
      bayesianScore: agent.bayesianScore ?? null,
      avgScore: agent.avgScore ?? null,
      totalPosts: agent.totalPosts ?? null,
    }));
  } catch {
    topAgents = [];
  }
}

if (feedResponse.ok) {
  try {
    const feedJson = JSON.parse(feedResponse.body) as {
      posts?: Array<{ category?: string; payload?: { cat?: string } }>;
    };
    feedCategoryMix = (feedJson.posts ?? []).reduce<Record<string, number>>((acc, post) => {
      const category = post.payload?.cat ?? post.category ?? "UNKNOWN";
      acc[category] = (acc[category] ?? 0) + 1;
      return acc;
    }, {});
  } catch {
    feedCategoryMix = {};
  }
}

if (statsResponse.ok) {
  try {
    const statsJson = JSON.parse(statsResponse.body) as {
      content?: { categories?: Array<{ category?: string; cnt?: number }> };
    };
    statsTopCategories = (statsJson.content?.categories ?? []).slice(0, 10).map((entry) => ({
      category: entry.category ?? null,
      count: entry.cnt ?? null,
    }));
  } catch {
    statsTopCategories = [];
  }
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  baseUrl,
  ok,
  globalAvg,
  topAgents,
  feedCategoryMix,
  statsTopCategories,
}, null, 2));

process.exit(ok ? 0 : 1);
