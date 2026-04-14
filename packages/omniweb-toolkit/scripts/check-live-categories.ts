#!/usr/bin/env npx tsx
/**
 * check-live-categories.ts — Report active category coverage from live stats and feed probes.
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
  console.log(`Usage: npx tsx scripts/check-live-categories.ts [--base-url URL] [--limit N] [--timeout-ms N]

Options:
  --base-url URL   SuperColony base URL (default: ${DEFAULT_BASE_URL})
  --limit N        Feed sample size for discovery (default: 50)
  --timeout-ms N   Request timeout in milliseconds (default: 15000)
  --help, -h       Show this help

Output: JSON report of category coverage from stats, feed, and category probes
Exit codes: 0 = success, 1 = fetch error, 2 = invalid args`);
  process.exit(0);
}

const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;
const limit = getNumberArg(args, "--limit") ?? 50;
const timeoutMs = getNumberArg(args, "--timeout-ms") ?? 15_000;

if (!Number.isInteger(limit) || limit < 1) {
  console.error("Error: --limit must be a positive integer");
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("Error: --timeout-ms must be a positive number");
  process.exit(2);
}

const knownCategories = [
  "ACTION",
  "ALERT",
  "ANALYSIS",
  "FEED",
  "OBSERVATION",
  "OPINION",
  "PREDICTION",
  "QUESTION",
  "SIGNAL",
  "VOTE",
];

const [statsResponse, feedResponse, ...probeResponses] = await Promise.all([
  fetchText("/api/stats", { baseUrl, timeoutMs, accept: "application/json" }),
  fetchText(`/api/feed?limit=${limit}`, { baseUrl, timeoutMs, accept: "application/json" }),
  ...knownCategories.map((category) =>
    fetchText(`/api/feed?limit=1&category=${encodeURIComponent(category)}`, {
      baseUrl,
      timeoutMs,
      accept: "application/json",
    })),
]);

let statsCategories: string[] = [];
let feedCategories: string[] = [];

if (statsResponse.ok) {
  try {
    const statsJson = JSON.parse(statsResponse.body) as {
      content?: { categories?: Array<{ category?: string }> };
    };
    statsCategories = (statsJson.content?.categories ?? [])
      .map((entry) => entry.category)
      .filter((value): value is string => typeof value === "string");
  } catch {
    statsCategories = [];
  }
}

if (feedResponse.ok) {
  try {
    const feedJson = JSON.parse(feedResponse.body) as {
      posts?: Array<{ category?: string; payload?: { cat?: string } }>;
    };
    feedCategories = Array.from(new Set(
      (feedJson.posts ?? [])
        .map((post) => post.payload?.cat ?? post.category)
        .filter((value): value is string => typeof value === "string"),
    )).sort();
  } catch {
    feedCategories = [];
  }
}

const probeResults = probeResponses.map((response, index) => {
  let posts = 0;

  if (response.ok) {
    try {
      const feedJson = JSON.parse(response.body) as { posts?: unknown[] };
      posts = Array.isArray(feedJson.posts) ? feedJson.posts.length : 0;
    } catch {
      posts = 0;
    }
  }

  return {
    category: knownCategories[index],
    httpStatus: response.status,
    posts,
    ok: response.ok,
    error: response.error,
  };
});

const activeCategories = Array.from(new Set([
  ...statsCategories,
  ...feedCategories,
  ...probeResults
    .filter((result) => result.ok && result.posts > 0)
    .map((result) => result.category),
])).sort();

const ok = statsResponse.ok && feedResponse.ok && probeResults.every((result) => result.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  baseUrl,
  ok,
  sources: {
    statsHttpStatus: statsResponse.status,
    feedHttpStatus: feedResponse.status,
  },
  statsCategories,
  feedCategories,
  activeCategories,
  probeResults,
}, null, 2));

process.exit(ok ? 0 : 1);
