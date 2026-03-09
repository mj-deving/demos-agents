#!/usr/bin/env npx tsx
/**
 * Room Temperature Assessment — Sentinel Phase 2 tool
 *
 * Maps to strategy.yaml SCAN phase, roomTemperature.questions.
 * Fetches feed data and answers the 6 room temperature questions:
 *   1. Activity level (posts in last N hours)
 *   2. Convergence (3+ agents on same topic)
 *   3. Gaps (unattested numeric claims)
 *   4. Heat (topic with most reactions)
 *   5. Twitter delta (placeholder — requires bird CLI)
 *   6. Meta saturation (50%+ posts are generic meta-analysis)
 *
 * Usage:
 *   npx tsx tools/room-temp.ts [--env PATH] [--limit N] [--hours N] [--json] [--pretty]
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { connectWallet, apiCall, info } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";

// ── Arg Parsing ────────────────────────────────────

function parseArgs(): { flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};

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
    }
  }

  return { flags };
}

function printHelp(): void {
  console.log(`
Room Temperature Assessment — Sentinel SCAN phase tool

USAGE:
  npx tsx tools/room-temp.ts [flags]

FLAGS:
  --env PATH     Path to .env file (default: .env in cwd)
  --limit N      Feed posts to fetch (default: 50)
  --hours N      Time window for activity count (default: 6)
  --json         Output structured JSON (for piping)
  --pretty       Human-readable formatted output
  --help, -h     Show this help

EXAMPLES:
  npx tsx tools/room-temp.ts --pretty
  npx tsx tools/room-temp.ts --json --hours 12
  npx tsx tools/room-temp.ts --env ~/projects/DEMOS-Work/.env --pretty
`);
}

// ── Types ──────────────────────────────────────────

interface FeedPost {
  txHash: string;
  author: string;
  timestamp: number; // Unix ms
  score?: number;
  replyCount?: number;
  payload: {
    v?: number;
    cat: string;
    text: string;
    tags?: string[];
    assets?: string[];
    confidence?: number;
    sourceAttestations?: Array<{ url: string; responseHash: string; txHash: string }>;
    [key: string]: any;
  };
  reactions?: {
    agree?: number;
    disagree?: number;
    flag?: number;
  };
  agent?: {
    address: string;
    displayName?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface RoomTempResult {
  timestamp: string;
  activity: {
    count: number;
    level: string;
    posts_per_hour: number;
  };
  convergence: {
    detected: boolean;
    topic: string | null;
    agent_count: number;
    agents: string[];
  };
  gaps: {
    found: boolean;
    unattested_claims: number;
    topics: string[];
  };
  heat: {
    topic: string | null;
    reactions: number;
    top_post_tx: string | null;
  };
  twitter_delta: null;
  meta_saturation: {
    ratio: number;
    level: string;
    meta_count: number;
    total_count: number;
  };
  recommendation: string;
}

// ── Analysis Functions ─────────────────────────────

/**
 * Count posts within time window and classify activity level.
 */
function analyzeActivity(posts: FeedPost[], hours: number): RoomTempResult["activity"] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = posts.filter(p => p.timestamp > cutoff);
  const count = recent.length;
  const postsPerHour = hours > 0 ? +(count / hours).toFixed(1) : 0;

  let level: string;
  if (count < 5) level = "LOW";
  else if (count <= 15) level = "MODERATE";
  else level = "HIGH";

  return { count, level, posts_per_hour: postsPerHour };
}

/**
 * Detect convergence: 3+ unique agents posting about the same topic.
 * Groups by tags and asset overlap.
 */
function analyzeConvergence(posts: FeedPost[]): RoomTempResult["convergence"] {
  // Build topic → authors map using payload.tags and payload.assets
  const topicAuthors: Record<string, Set<string>> = {};

  for (const post of posts) {
    const topics: string[] = [];
    if (post.payload?.tags) topics.push(...post.payload.tags);
    if (post.payload?.assets) topics.push(...post.payload.assets);

    for (const topic of topics) {
      const key = topic.toLowerCase();
      if (!topicAuthors[key]) topicAuthors[key] = new Set();
      topicAuthors[key].add(post.author);
    }
  }

  // Find topic with most unique agents (minimum 3)
  let bestTopic: string | null = null;
  let bestCount = 0;
  let bestAgents: string[] = [];

  for (const [topic, authors] of Object.entries(topicAuthors)) {
    if (authors.size >= 3 && authors.size > bestCount) {
      bestTopic = topic;
      bestCount = authors.size;
      bestAgents = [...authors];
    }
  }

  return {
    detected: bestTopic !== null,
    topic: bestTopic,
    agent_count: bestCount,
    agents: bestAgents.slice(0, 10), // Cap display
  };
}

/**
 * Detect gaps: posts with numeric claims but no attestation.
 * Heuristic: text matches numeric patterns AND has no attestation field.
 */
function analyzeGaps(posts: FeedPost[]): RoomTempResult["gaps"] {
  const numericPattern = /\d+(\.\d+)?%|\$\d+|\d+\.\d+\s*(bbl|usd|btc|eth)/i;
  const gapPosts: FeedPost[] = [];

  for (const post of posts) {
    const text = post.payload?.text || "";
    const hasNumericClaim = numericPattern.test(text);
    const hasAttestation =
      (post.payload?.sourceAttestations && post.payload.sourceAttestations.length > 0) ||
      (post.payload?.tlsnAttestations && (post.payload.tlsnAttestations as any[]).length > 0);
    if (hasNumericClaim && !hasAttestation) {
      gapPosts.push(post);
    }
  }

  // Extract topics from gap posts
  const topics = new Set<string>();
  for (const post of gapPosts) {
    if (post.payload?.tags) post.payload.tags.forEach(t => topics.add(t));
    if (post.payload?.assets) post.payload.assets.forEach(a => topics.add(a));
  }

  return {
    found: gapPosts.length > 0,
    unattested_claims: gapPosts.length,
    topics: [...topics].slice(0, 10),
  };
}

/**
 * Identify hottest topic by total reaction count.
 */
function analyzeHeat(posts: FeedPost[]): RoomTempResult["heat"] {
  let maxReactions = 0;
  let hotPost: FeedPost | null = null;

  for (const post of posts) {
    const reactions = (post.reactions?.agree || 0) +
                      (post.reactions?.disagree || 0) +
                      (post.reactions?.flag || 0);
    if (reactions > maxReactions) {
      maxReactions = reactions;
      hotPost = post;
    }
  }

  let topic: string | null = null;
  if (hotPost) {
    topic = hotPost.payload?.tags?.[0] || hotPost.payload?.assets?.[0] || hotPost.payload?.cat || null;
  }

  return {
    topic,
    reactions: maxReactions,
    top_post_tx: hotPost?.txHash || null,
  };
}

/**
 * Detect meta-saturation: when 50%+ of posts are generic meta-analysis
 * (analyzing "the feed" itself rather than external data).
 * Heuristic: posts with NO attestation AND text matches feed-referencing patterns.
 */
function analyzeMetaSaturation(posts: FeedPost[]): RoomTempResult["meta_saturation"] {
  const metaPattern = /\b(agents?\s+(are|have|keep|seem|appear)|the feed|consensus\s+(is|has|shows)|meta[\s-]?analysis|leaderboard|hive\s*mind|collective\s+intelligence|shared\s+nervous)\b/i;

  let metaCount = 0;
  for (const post of posts) {
    const text = post.payload?.text || "";
    const hasAttestation =
      (post.payload?.sourceAttestations && post.payload.sourceAttestations.length > 0) ||
      (post.payload?.tlsnAttestations && (post.payload.tlsnAttestations as any[]).length > 0);

    if (!hasAttestation && metaPattern.test(text)) {
      metaCount++;
    }
  }

  const total = posts.length;
  const ratio = total > 0 ? +(metaCount / total).toFixed(2) : 0;
  const level = ratio >= 0.5 ? "HIGH" : ratio >= 0.3 ? "MODERATE" : "LOW";

  return { ratio, level, meta_count: metaCount, total_count: total };
}

/**
 * Generate recommendation text from analysis.
 */
function generateRecommendation(
  activity: RoomTempResult["activity"],
  convergence: RoomTempResult["convergence"],
  gaps: RoomTempResult["gaps"],
  heat: RoomTempResult["heat"],
  metaSaturation?: RoomTempResult["meta_saturation"]
): string {
  const parts: string[] = [];

  parts.push(`${activity.level} activity (${activity.count} posts, ${activity.posts_per_hour}/hr).`);

  if (convergence.detected) {
    parts.push(`Convergence on "${convergence.topic}" — ${convergence.agent_count} agents, synthesis opportunity.`);
  }

  if (gaps.found) {
    parts.push(`${gaps.unattested_claims} unattested numeric claim(s) to fill.`);
  }

  if (heat.topic && heat.reactions > 5) {
    parts.push(`Hot topic: "${heat.topic}" (${heat.reactions} reactions).`);
  }

  if (metaSaturation && metaSaturation.level === "HIGH") {
    parts.push(`META SATURATION: ${metaSaturation.meta_count}/${metaSaturation.total_count} posts are generic meta — opportunity for data-backed counter-posts.`);
  } else if (metaSaturation && metaSaturation.level === "MODERATE") {
    parts.push(`Meta trending: ${metaSaturation.meta_count}/${metaSaturation.total_count} generic meta posts — consider data-backed content.`);
  }

  return parts.join(" ");
}

// ── Pretty Output ──────────────────────────────────

function prettyPrint(result: RoomTempResult): void {
  console.log(`\nROOM TEMPERATURE — ${result.timestamp}\n`);

  // Activity
  const actIcon = result.activity.level === "LOW" ? "🟡" : result.activity.level === "HIGH" ? "🔴" : "🟢";
  console.log(`  ${actIcon} Activity: ${result.activity.level} — ${result.activity.count} posts in window (${result.activity.posts_per_hour}/hr)`);

  // Convergence
  if (result.convergence.detected) {
    console.log(`  🔀 Convergence: YES — "${result.convergence.topic}" (${result.convergence.agent_count} agents)`);
    console.log(`     Agents: ${result.convergence.agents.map(a => a.slice(0, 10) + "…").join(", ")}`);
  } else {
    console.log(`  🔀 Convergence: none detected`);
  }

  // Gaps
  if (result.gaps.found) {
    console.log(`  ⚠️  Gaps: ${result.gaps.unattested_claims} unattested numeric claim(s)`);
    if (result.gaps.topics.length > 0) {
      console.log(`     Topics: ${result.gaps.topics.join(", ")}`);
    }
  } else {
    console.log(`  ✅ Gaps: no unattested numeric claims found`);
  }

  // Heat
  if (result.heat.topic) {
    console.log(`  🔥 Heat: "${result.heat.topic}" — ${result.heat.reactions} reactions`);
    if (result.heat.top_post_tx) {
      console.log(`     Top post: ${result.heat.top_post_tx.slice(0, 16)}…`);
    }
  } else {
    console.log(`  🔥 Heat: no standout topic`);
  }

  // Meta saturation
  const metaIcon = result.meta_saturation.level === "HIGH" ? "🟠" : result.meta_saturation.level === "MODERATE" ? "🟡" : "🟢";
  console.log(`  ${metaIcon} Meta saturation: ${result.meta_saturation.level} — ${result.meta_saturation.meta_count}/${result.meta_saturation.total_count} posts are generic meta (${(result.meta_saturation.ratio * 100).toFixed(0)}%)`);

  // Twitter
  console.log(`  🐦 Twitter delta: not available (requires bird CLI)`);

  // Recommendation
  console.log(`\n  💡 ${result.recommendation}\n`);
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const envPath = flags["env"] || resolve(process.cwd(), ".env");
  const limit = parseInt(flags["limit"] || "50") || 50;
  const hours = parseInt(flags["hours"] || "6") || 6;
  if (limit < 1 || limit > 200) throw new Error("--limit must be 1-200");
  if (hours < 1 || hours > 168) throw new Error("--hours must be 1-168");
  const jsonOutput = flags["json"] === "true";
  const prettyOutput = flags["pretty"] === "true";

  // Connect and auth
  const { demos, address } = await connectWallet(envPath);
  const token = await ensureAuth(demos, address);

  // Fetch feed
  info(`Fetching ${limit} posts...`);
  const feedRes = await apiCall(`/api/feed?limit=${limit}`, token);
  if (!feedRes.ok) {
    throw new Error(`Feed request failed (${feedRes.status}): ${JSON.stringify(feedRes.data)}`);
  }

  const rawPosts = feedRes.data?.posts ?? feedRes.data;
  const posts: FeedPost[] = Array.isArray(rawPosts) ? rawPosts : [];
  info(`Got ${posts.length} posts`);

  // Analyze
  const activity = analyzeActivity(posts, hours);
  const convergence = analyzeConvergence(posts);
  const gaps = analyzeGaps(posts);
  const heat = analyzeHeat(posts);
  const metaSaturation = analyzeMetaSaturation(posts);
  const recommendation = generateRecommendation(activity, convergence, gaps, heat, metaSaturation);

  const result: RoomTempResult = {
    timestamp: new Date().toISOString(),
    activity,
    convergence,
    gaps,
    heat,
    twitter_delta: null,
    meta_saturation: metaSaturation,
    recommendation,
  };

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(result));
  } else if (prettyOutput) {
    prettyPrint(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error(`[room-temp] ERROR: ${err.message}`);
  process.exit(1);
});
