#!/usr/bin/env npx tsx
/**
 * Room Temperature Assessment — SCAN phase tool
 *
 * Supports multi-mode scanning with quality filtering.
 * Backward compatible with legacy flags --limit and --hours.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { connectWallet, info, setLogAgent } from "../src/lib/network/sdk.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../src/toolkit/sdk-bridge.js";
import { observe, initObserver } from "../src/lib/pipeline/observe.js";
import { resolveAgentName, loadAgentConfig } from "../src/lib/agent-config.js";
import {
  NUMERIC_CLAIM_PATTERN,
  buildAgentIndex,
  buildTopicIndex,
  filterPosts,
  type AgentStats,
  type FilteredPost,
  type QualityFilter,
  type TopicStats,
} from "../src/lib/pipeline/feed-filter.js";

type ScanMode = "lightweight" | "since-last" | "topic-search" | "category-filtered" | "quality-indexed";

const ALLOWED_MODES = new Set<ScanMode>([
  "lightweight",
  "since-last",
  "topic-search",
  "category-filtered",
  "quality-indexed",
]);

interface RoomTempResult {
  timestamp: string;
  modes: ScanMode[];
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
  topicIndex?: Record<string, TopicStatsJson>;
  agentIndex?: Record<string, AgentStats>;
  sinceLastPosts?: number;
  categoryBreakdown?: Record<string, number>;
  qualityStats?: {
    totalFetched: number;
    passedFilter: number;
    filteredOut: number;
    avgScoreOfPassed: number;
  };
  rawPosts?: FilteredPost[];
}

interface TopicStatsJson {
  count: number;
  totalReactions: number;
  attestedCount: number;
  uniqueAuthors: string[];
  avgScore: number;
  newestTimestamp: number;
}

interface QualityCounters {
  totalFetched: number;
  passedFilter: number;
  totalPassedScore: number;
}

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
Room Temperature Assessment — SCAN phase tool

USAGE:
  npx tsx cli/scan-feed.ts [flags]

FLAGS:
  --agent NAME       Agent name (default: sentinel)
  --env PATH         Path to .env file (default: .env in cwd)
  --mode MODES       Comma-separated: lightweight,since-last,topic-search,category-filtered,quality-indexed
  --limit N          Legacy/compat depth override (default: scan.depth or 200)
  --hours N          Time window for activity count (default: 6)
  --since UNIX_MS    Used by since-last mode; if omitted, inferred from session log
  --topics LIST      Comma-separated topics for topic-search mode
  --categories LIST  Comma-separated categories for category-filtered mode
  --json             Compact JSON output
  --pretty           Human-readable output
  --help, -h         Show this help

EXAMPLES:
  npx tsx cli/scan-feed.ts --mode lightweight --agent sentinel --pretty
  npx tsx cli/scan-feed.ts --mode topic-search --topics quantum,biotech --agent pioneer --json
  npx tsx cli/scan-feed.ts --mode since-last --since 1730764800000 --agent sentinel --json
`);
}

function parseCsv(input: string | undefined): string[] {
  return String(input || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseModes(raw: string[] | undefined): ScanMode[] {
  if (!raw || raw.length === 0) return ["lightweight"];
  const modes: ScanMode[] = [];
  for (const token of raw) {
    const lower = token.toLowerCase() as ScanMode;
    if (!ALLOWED_MODES.has(lower)) {
      throw new Error(`Invalid --mode value "${token}" (allowed: ${[...ALLOWED_MODES].join(", ")})`);
    }
    if (!modes.includes(lower)) modes.push(lower);
  }
  return modes;
}

function topicStatsFromPosts(posts: FilteredPost[]): TopicStatsJson {
  const uniqueAuthors = new Set<string>();
  let totalReactions = 0;
  let attestedCount = 0;
  let totalScore = 0;
  let newestTimestamp = 0;

  for (const p of posts) {
    uniqueAuthors.add(p.author);
    totalReactions += p.reactions.agree + p.reactions.disagree;
    if (p.hasAttestation) attestedCount += 1;
    totalScore += p.score;
    newestTimestamp = Math.max(newestTimestamp, p.timestamp || 0);
  }

  return {
    count: posts.length,
    totalReactions,
    attestedCount,
    uniqueAuthors: [...uniqueAuthors],
    avgScore: posts.length > 0 ? +(totalScore / posts.length).toFixed(1) : 0,
    newestTimestamp,
  };
}

function topicMapToJson(map: Map<string, TopicStats>): Record<string, TopicStatsJson> {
  const out: Record<string, TopicStatsJson> = {};
  for (const [topic, stats] of map.entries()) {
    out[topic] = {
      count: stats.count,
      totalReactions: stats.totalReactions,
      attestedCount: stats.attestedCount,
      uniqueAuthors: [...stats.uniqueAuthors],
      avgScore: stats.avgScore,
      newestTimestamp: stats.newestTimestamp,
    };
  }
  return out;
}

function agentMapToJson(map: Map<string, AgentStats>): Record<string, AgentStats> {
  const out: Record<string, AgentStats> = {};
  for (const [address, stats] of map.entries()) {
    out[address] = stats;
  }
  return out;
}

function dedupePosts(posts: FilteredPost[]): FilteredPost[] {
  const byTx = new Map<string, FilteredPost>();
  for (const p of posts) {
    const existing = byTx.get(p.txHash);
    if (!existing || p.timestamp > existing.timestamp) {
      byTx.set(p.txHash, p);
    }
  }
  return [...byTx.values()];
}

function dedupeRawFeedPosts(posts: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const p of posts) {
    const txHash = String(p?.txHash || "");
    const timestamp = Number(p?.timestamp || 0);
    const fallbackKey = [
      String(p?.author || p?.address || ""),
      String(p?.payload?.cat || p?.cat || ""),
      String(p?.payload?.text || p?.text || "").slice(0, 64),
      String(timestamp),
    ].join("|");
    const key = txHash ? `tx:${txHash}` : `raw:${fallbackKey}`;

    const existing = byKey.get(key);
    const existingTs = Number(existing?.timestamp || 0);
    if (!existing || timestamp > existingTs) {
      byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

function updateCounters(counters: QualityCounters, fetched: number, filtered: FilteredPost[]): void {
  counters.totalFetched += fetched;
  counters.passedFilter += filtered.length;
  for (const post of filtered) counters.totalPassedScore += post.score;
}

function analyzeActivity(
  posts: FilteredPost[],
  hours: number,
  throughputPosts: Array<{ timestamp?: number }> = posts
): RoomTempResult["activity"] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = throughputPosts.filter((p) => Number(p?.timestamp || 0) > cutoff);
  const count = recent.length;
  const postsPerHour = hours > 0 ? +(count / hours).toFixed(1) : 0;

  let level: string;
  if (count < 5) level = "LOW";
  else if (count <= 15) level = "MODERATE";
  else level = "HIGH";

  return { count, level, posts_per_hour: postsPerHour };
}

function analyzeConvergence(posts: FilteredPost[]): RoomTempResult["convergence"] {
  const topicAuthors: Record<string, Set<string>> = {};

  for (const post of posts) {
    const topics = [...post.tags, ...post.assets].map((t) => t.toLowerCase());
    for (const topic of topics) {
      if (!topicAuthors[topic]) topicAuthors[topic] = new Set();
      topicAuthors[topic].add(post.author);
    }
  }

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
    agents: bestAgents.slice(0, 10),
  };
}

function analyzeGaps(posts: FilteredPost[], agentFocusTopics?: string[]): RoomTempResult["gaps"] {
  // 1. Unattested numeric claims (original logic)
  const gapPosts = posts.filter((p) => NUMERIC_CLAIM_PATTERN.test(p.textPreview) && !p.hasAttestation);
  const topics = new Set<string>();
  for (const post of gapPosts) {
    for (const tag of post.tags) topics.add(tag.toLowerCase());
    for (const asset of post.assets) topics.add(asset.toLowerCase());
  }

  // 2. Topic coverage gaps — agent's focus topics with 0 posts in scan window
  if (agentFocusTopics && agentFocusTopics.length > 0) {
    const feedTopics = new Set<string>();
    for (const p of posts) {
      for (const tag of p.tags) feedTopics.add(tag.toLowerCase());
      for (const asset of p.assets) feedTopics.add(asset.toLowerCase());
    }
    for (const focus of agentFocusTopics) {
      const focusLower = focus.toLowerCase();
      if (!feedTopics.has(focusLower)) {
        topics.add(focusLower);
      }
    }
  }

  return {
    found: gapPosts.length > 0 || topics.size > 0,
    unattested_claims: gapPosts.length,
    topics: [...topics].slice(0, 10),
  };
}

function analyzeHeat(posts: FilteredPost[]): RoomTempResult["heat"] {
  let hotPost: FilteredPost | null = null;
  let maxReactions = 0;

  for (const post of posts) {
    const reactions = post.reactions.agree + post.reactions.disagree;
    if (reactions > maxReactions) {
      maxReactions = reactions;
      hotPost = post;
    }
  }

  const topic = hotPost
    ? (hotPost.tags[0] || hotPost.assets[0] || hotPost.category || null)
    : null;

  return {
    topic,
    reactions: maxReactions,
    top_post_tx: hotPost?.txHash || null,
  };
}

function analyzeMetaSaturation(posts: FilteredPost[]): RoomTempResult["meta_saturation"] {
  const metaPattern = /\b(agents?\s+(are|have|keep|seem|appear)|the feed|consensus\s+(is|has|shows)|meta[\s-]?analysis|leaderboard|hive\s*mind|collective\s+intelligence|shared\s+nervous)\b/i;

  let metaCount = 0;
  for (const post of posts) {
    if (!post.hasAttestation && metaPattern.test(post.textPreview)) {
      metaCount++;
    }
  }

  const total = posts.length;
  const ratio = total > 0 ? +(metaCount / total).toFixed(2) : 0;
  const level = ratio >= 0.5 ? "HIGH" : ratio >= 0.3 ? "MODERATE" : "LOW";
  return { ratio, level, meta_count: metaCount, total_count: total };
}

function generateRecommendation(
  activity: RoomTempResult["activity"],
  convergence: RoomTempResult["convergence"],
  gaps: RoomTempResult["gaps"],
  heat: RoomTempResult["heat"],
  metaSaturation: RoomTempResult["meta_saturation"]
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
  if (metaSaturation.level === "HIGH") {
    parts.push(`META SATURATION: ${metaSaturation.meta_count}/${metaSaturation.total_count} posts are generic meta — opportunity for data-backed counter-posts.`);
  } else if (metaSaturation.level === "MODERATE") {
    parts.push(`Meta trending: ${metaSaturation.meta_count}/${metaSaturation.total_count} generic meta posts — consider data-backed content.`);
  }

  return parts.join(" ");
}

function inferSinceFromSessionLog(logPath: string): number | null {
  if (!existsSync(logPath)) return null;
  const content = readFileSync(logPath, "utf-8").trim();
  if (!content) return null;

  let maxTs = 0;
  for (const line of content.split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (!entry?.txHash) continue;
      const ts = Date.parse(String(entry.timestamp || ""));
      if (Number.isFinite(ts)) maxTs = Math.max(maxTs, ts);
    } catch {
      // Ignore malformed lines.
    }
  }
  return maxTs > 0 ? maxTs : null;
}

function prettyPrint(result: RoomTempResult): void {
  console.log(`\nROOM TEMPERATURE — ${result.timestamp}`);
  console.log(`Modes: ${result.modes.join(", ")}\n`);

  const actIcon = result.activity.level === "LOW" ? "🟡" : result.activity.level === "HIGH" ? "🔴" : "🟢";
  console.log(`  ${actIcon} Activity: ${result.activity.level} — ${result.activity.count} posts (${result.activity.posts_per_hour}/hr)`);

  if (result.convergence.detected) {
    console.log(`  🔀 Convergence: YES — "${result.convergence.topic}" (${result.convergence.agent_count} agents)`);
  } else {
    console.log(`  🔀 Convergence: none detected`);
  }

  if (result.gaps.found) {
    console.log(`  ⚠️  Gaps: ${result.gaps.unattested_claims} unattested numeric claim(s)`);
    if (result.gaps.topics.length > 0) console.log(`     Topics: ${result.gaps.topics.join(", ")}`);
  } else {
    console.log(`  ✅ Gaps: no unattested numeric claims found`);
  }

  if (result.heat.topic) {
    console.log(`  🔥 Heat: "${result.heat.topic}" — ${result.heat.reactions} reactions`);
  } else {
    console.log(`  🔥 Heat: no standout topic`);
  }

  const metaIcon = result.meta_saturation.level === "HIGH" ? "🟠" : result.meta_saturation.level === "MODERATE" ? "🟡" : "🟢";
  console.log(`  ${metaIcon} Meta saturation: ${result.meta_saturation.level} — ${result.meta_saturation.meta_count}/${result.meta_saturation.total_count}`);

  if (result.qualityStats) {
    console.log(`  📊 Quality filter: ${result.qualityStats.passedFilter}/${result.qualityStats.totalFetched} passed (avg ${result.qualityStats.avgScoreOfPassed})`);
  }
  if (typeof result.sinceLastPosts === "number") {
    console.log(`  ⏱️  Since-last posts: ${result.sinceLastPosts}`);
  }
  if (result.categoryBreakdown) {
    console.log(`  🗂️  Category breakdown: ${JSON.stringify(result.categoryBreakdown)}`);
  }
  if (result.topicIndex) {
    console.log(`  🧭 Topic index entries: ${Object.keys(result.topicIndex).length}`);
  }
  if (result.agentIndex) {
    console.log(`  👥 Agent index entries: ${Object.keys(result.agentIndex).length}`);
  }

  console.log(`\n  💡 ${result.recommendation}\n`);
}

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  initObserver(agentName, 0); // session 0 = subprocess context (actual session# set by runner)
  const config = loadAgentConfig(agentName);
  const envPath = flags["env"] || resolve(process.cwd(), ".env");
  const hours = parseInt(flags["hours"] || "6", 10) || 6;
  if (hours < 1 || hours > 168) throw new Error("--hours must be 1-168");

  const scanModes = parseModes(
    parseCsv(flags["mode"]).length > 0
      ? parseCsv(flags["mode"])
      : (config.scan?.modes || ["lightweight"])
  );

  const depthDefault = config.scan?.depth ?? 1000;
  const depth = parseInt(flags["limit"] || String(depthDefault), 10) || depthDefault;
  if (depth < 1 || depth > 1000) throw new Error("--limit/depth must be 1-1000");

  const qualityFloor = config.scan?.qualityFloor ?? 70;
  const requireAttestation = config.scan?.requireAttestation ?? false;
  const topicSearchLimit = config.scan?.topicSearchLimit ?? 30;
  const cacheHours = config.scan?.cacheHours ?? 4;
  const jsonOutput = flags["json"] === "true";
  const prettyOutput = flags["pretty"] === "true";

  const qualityFilter: QualityFilter = {
    minScore: qualityFloor,
    requireAttestation,
  };

  const { demos, address } = await connectWallet(envPath);
  const bridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);

  // Fetch feed from chain — single scan replaces multi-mode API pagination.
  // NEW-2: Fall back to API feed if chain RPC is down (502/timeout).
  info("Fetching feed from chain...");
  let chainPosts: Awaited<ReturnType<typeof bridge.getHivePosts>>;
  try {
    chainPosts = await bridge.getHivePosts(500);
    info(`Chain: ${chainPosts.length} posts fetched`);
  } catch (chainErr: unknown) {
    const msg = chainErr instanceof Error ? chainErr.message : String(chainErr);
    info(`Chain RPC failed (${msg}), falling back to API feed...`);
    try {
      const res = await fetch("https://supercolony.ai/api/feed?limit=100");
      if (!res.ok) throw new Error(`API feed ${res.status}`);
      const data = await res.json() as { posts: Array<{ txHash: string; author: string; timestamp: number; payload: any; reactions?: any; score?: number }> };
      chainPosts = (data.posts ?? []).map(p => ({
        txHash: p.txHash,
        author: p.author,
        timestamp: p.timestamp,
        text: String(p.payload?.text ?? ""),
        category: String(p.payload?.cat ?? ""),
        tags: p.payload?.tags ?? [],
        reactions: p.reactions ?? { agree: 0, disagree: 0 },
        reactionsKnown: !!(p.reactions),
        blockNumber: 0,
      }));
      info(`API fallback: ${chainPosts.length} posts fetched`);
    } catch {
      throw new Error(`Chain RPC failed and API fallback also failed: ${msg}`);
    }
  }

  // Map chain posts to API-compatible shape for filterPosts
  // Compute score locally — deterministic formula from strategy.yaml
  const chainRawPosts = chainPosts.map(p => {
    const rx = p.reactions.agree + p.reactions.disagree;
    let score = 20; // base
    if (p.text.length > 200) score += 40 + 10; // attestation + long_text (quality gate enforces both)
    if (p.category) score += 10; // confidence
    if (rx >= 5) score += 10;
    if (rx >= 15) score += 10;
    return {
      txHash: p.txHash,
      author: p.author,
      score: Math.min(score, 100),
      timestamp: p.timestamp,
      payload: { tags: p.tags || [], assets: [], text: p.text, cat: p.category },
      reactions: p.reactions,
      text: p.text,
    };
  });

  const counters: QualityCounters = { totalFetched: 0, passedFilter: 0, totalPassedScore: 0 };
  const allFiltered: FilteredPost[] = [];
  const allRawFetched: any[] = [];

  let topicIndexOut: Record<string, TopicStatsJson> | undefined;
  let agentIndexOut: Record<string, AgentStats> | undefined;
  let sinceLastPosts: number | undefined;
  let categoryBreakdown: Record<string, number> | undefined;

  // ── Scan Cache ─────────────────────────────────
  const scanCacheDir = resolve(homedir(), ".demos-scan-cache");
  const scanCachePath = resolve(scanCacheDir, `${agentName}-feed.json`);
  const scanCacheTtlMs = (config.scan?.cacheHours ?? 1) * 60 * 60 * 1000;

  interface ScanCache {
    generatedAt: number;
    newestTimestamp: number;
    posts: any[];
  }

  function loadScanCache(): ScanCache | null {
    if (!existsSync(scanCachePath)) return null;
    try {
      const cached: ScanCache = JSON.parse(readFileSync(scanCachePath, "utf-8"));
      if (Date.now() - cached.generatedAt > scanCacheTtlMs) return null; // stale
      return cached;
    } catch { return null; }
  }

  function saveScanCache(posts: any[]): void {
    const timestamps = posts.map(p => Number(p?.timestamp || 0)).filter(t => t > 0);
    const newest = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
    const cache: ScanCache = { generatedAt: Date.now(), newestTimestamp: newest, posts };
    if (!existsSync(scanCacheDir)) mkdirSync(scanCacheDir, { recursive: true });
    const tmpPath = scanCachePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(cache));
    renameSync(tmpPath, scanCachePath);
  }

  // Chain-first: all modes use the same chain data — no API pagination needed
  // Save to cache for compatibility, pre-filter for reuse by modes
  saveScanCache(chainRawPosts);
  const chainFiltered = filterPosts(chainRawPosts, qualityFilter);

  for (const mode of scanModes) {
    if (mode === "lightweight") {
      info(`Mode lightweight: ${chainRawPosts.length} posts from chain`);
      allRawFetched.push(...chainRawPosts);
      updateCounters(counters, chainRawPosts.length, chainFiltered);
      allFiltered.push(...chainFiltered);
      continue;
    }

    if (mode === "since-last") {
      const sinceArg = Number(flags["since"] || 0);
      const sinceMs = Number.isFinite(sinceArg) && sinceArg > 0
        ? sinceArg
        : (inferSinceFromSessionLog(config.paths.logFile) ?? (Date.now() - 24 * 60 * 60 * 1000));

      info(`Mode since-last: filtering chain posts since ${sinceMs}`);
      const recentRaw = chainRawPosts.filter((p: any) => {
        const ts = Number(p?.timestamp || 0);
        return Number.isFinite(ts) && ts >= sinceMs;
      });
      const filtered = filterPosts(recentRaw, qualityFilter);
      sinceLastPosts = filtered.length;
      continue;
    }

    if (mode === "topic-search") {
      const topics = parseCsv(flags["topics"]);
      const topicQueries = topics.length > 0 ? topics : config.topics.secondary.slice(0, 3);
      const out: Record<string, TopicStatsJson> = {};

      // Client-side topic search on chain data (replaces API search)
      for (const topic of topicQueries) {
        info(`Mode topic-search: ${topic} (chain-local)`);
        const topicLower = topic.toLowerCase();
        const matched = chainFiltered.filter(p =>
          p.tags.some(t => t.toLowerCase().includes(topicLower)) ||
          p.textPreview.toLowerCase().includes(topicLower)
        );
        out[topicLower] = topicStatsFromPosts(matched);
      }

      topicIndexOut = { ...(topicIndexOut || {}), ...out };
      continue;
    }

    if (mode === "category-filtered") {
      const categories = parseCsv(flags["categories"]);
      const requested = categories.length > 0 ? categories : ["QUESTION"];
      if (!categoryBreakdown) categoryBreakdown = {};

      // Client-side category filter on chain data
      for (const category of requested) {
        const upper = category.toUpperCase();
        info(`Mode category-filtered: ${upper} (chain-local)`);
        const matched = chainFiltered.filter(p => p.category.toUpperCase() === upper);
        categoryBreakdown[upper] = matched.length;
      }
      continue;
    }

    if (mode === "quality-indexed") {
      const cacheDir = resolve(homedir(), ".demos-scan-cache");
      const cachePath = resolve(cacheDir, `${agentName}-quality-index.json`);

      info("Mode quality-indexed: building index from chain data");

      // Build indices from already-filtered chain data
      const topicMap = buildTopicIndex(chainFiltered);
      const agentMap = buildAgentIndex(chainFiltered);
      topicIndexOut = topicMapToJson(topicMap);
      agentIndexOut = agentMapToJson(agentMap);

      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      writeFileSync(cachePath, JSON.stringify({
        generatedAt: Date.now(),
        topicIndex: topicIndexOut,
        agentIndex: agentIndexOut,
      }, null, 2));
      continue;
    }
  }

  const posts = dedupePosts(allFiltered);
  const dedupedRawPosts = dedupeRawFeedPosts(allRawFetched);

  // Always build topic index from the full deduped post set and merge with
  // any topic-search results so that extractTopicsFromScan sees the complete
  // picture (targeted search hits + broad feed discovery).
  const broadTopicIndex = topicMapToJson(buildTopicIndex(posts));
  if (topicIndexOut) {
    // Merge: broad index entries that aren't already covered by targeted search
    for (const [topic, stats] of Object.entries(broadTopicIndex)) {
      if (!topicIndexOut[topic]) {
        topicIndexOut[topic] = stats;
      }
    }
  } else {
    topicIndexOut = broadTopicIndex;
  }
  if (!agentIndexOut) {
    agentIndexOut = agentMapToJson(buildAgentIndex(posts));
  }

  const activity = analyzeActivity(posts, hours, dedupedRawPosts.length > 0 ? dedupedRawPosts : posts);
  const convergence = analyzeConvergence(posts);
  const agentFocusTopics = [...(config.topics?.primary || []), ...(config.topics?.secondary || [])];
  const gaps = analyzeGaps(posts, agentFocusTopics);
  const heat = analyzeHeat(posts);
  const metaSaturation = analyzeMetaSaturation(posts);
  const recommendation = generateRecommendation(activity, convergence, gaps, heat, metaSaturation);

  const qualityStats = {
    totalFetched: counters.totalFetched,
    passedFilter: counters.passedFilter,
    filteredOut: Math.max(0, counters.totalFetched - counters.passedFilter),
    avgScoreOfPassed: counters.passedFilter > 0
      ? +(counters.totalPassedScore / counters.passedFilter).toFixed(1)
      : 0,
  };

  const result: RoomTempResult = {
    timestamp: new Date().toISOString(),
    modes: scanModes,
    activity,
    convergence,
    gaps,
    heat,
    twitter_delta: null,
    meta_saturation: metaSaturation,
    recommendation,
    topicIndex: topicIndexOut,
    agentIndex: agentIndexOut,
    sinceLastPosts,
    categoryBreakdown,
    qualityStats,
    rawPosts: posts,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result));
  } else if (prettyOutput) {
    prettyPrint(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(`[scan-feed] ERROR: ${err.message}`);
  process.exit(1);
});
