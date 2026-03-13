#!/usr/bin/env npx tsx
/**
 * Room Temperature Assessment — SCAN phase tool
 *
 * Supports multi-mode scanning with quality filtering.
 * Backward compatible with legacy flags --limit and --hours.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connectWallet, apiCall, info, setLogAgent } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";
import { resolveAgentName, loadAgentConfig } from "./lib/agent-config.js";
import {
  NUMERIC_CLAIM_PATTERN,
  buildAgentIndex,
  buildTopicIndex,
  filterPosts,
  type AgentStats,
  type FilteredPost,
  type QualityFilter,
  type TopicStats,
} from "./lib/feed-filter.js";

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
  npx tsx tools/room-temp.ts [flags]

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
  npx tsx tools/room-temp.ts --mode lightweight --agent sentinel --pretty
  npx tsx tools/room-temp.ts --mode topic-search --topics quantum,biotech --agent pioneer --json
  npx tsx tools/room-temp.ts --mode since-last --since 1730764800000 --agent sentinel --json
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

function normalizeFeedPosts(payload: any): any[] {
  const posts =
    payload?.posts ??
    payload?.results ??
    payload?.items ??
    payload?.data?.posts ??
    payload?.data ??
    payload ??
    [];
  if (!Array.isArray(posts)) return [];
  return posts;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    }),
  ]);
}

class ApiBudget {
  private calls = 0;

  constructor(
    private readonly token: string,
    private readonly maxCalls: number,
    private readonly timeoutMs: number
  ) {}

  async get(path: string, label: string): Promise<any[]> {
    if (this.calls >= this.maxCalls) {
      throw new Error(`SCAN call budget exceeded (${this.maxCalls} max per invocation)`);
    }
    this.calls += 1;

    const res = await withTimeout(apiCall(path, this.token), this.timeoutMs, label);
    if (!res.ok) {
      throw new Error(`${label} failed (${res.status}): ${JSON.stringify(res.data)}`);
    }
    return normalizeFeedPosts(res.data);
  }
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

function analyzeGaps(posts: FilteredPost[]): RoomTempResult["gaps"] {
  const gapPosts = posts.filter((p) => NUMERIC_CLAIM_PATTERN.test(p.textPreview) && !p.hasAttestation);
  const topics = new Set<string>();
  for (const post of gapPosts) {
    for (const tag of post.tags) topics.add(tag.toLowerCase());
    for (const asset of post.assets) topics.add(asset.toLowerCase());
  }

  return {
    found: gapPosts.length > 0,
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
  const config = loadAgentConfig(agentName);
  const envPath = flags["env"] || resolve(process.cwd(), ".env");
  const hours = parseInt(flags["hours"] || "6", 10) || 6;
  if (hours < 1 || hours > 168) throw new Error("--hours must be 1-168");

  const scanModes = parseModes(
    parseCsv(flags["mode"]).length > 0
      ? parseCsv(flags["mode"])
      : (config.scan?.modes || ["lightweight"])
  );

  const depthDefault = config.scan?.depth ?? 200;
  const depth = parseInt(flags["limit"] || String(depthDefault), 10) || depthDefault;
  if (depth < 1 || depth > 200) throw new Error("--limit/depth must be 1-200");

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
  const token = await ensureAuth(demos, address);
  const budget = new ApiBudget(token, 10, 20_000);

  const counters: QualityCounters = { totalFetched: 0, passedFilter: 0, totalPassedScore: 0 };
  const allFiltered: FilteredPost[] = [];
  const allRawFetched: any[] = [];

  let topicIndexOut: Record<string, TopicStatsJson> | undefined;
  let agentIndexOut: Record<string, AgentStats> | undefined;
  let sinceLastPosts: number | undefined;
  let categoryBreakdown: Record<string, number> | undefined;

  for (const mode of scanModes) {
    if (mode === "lightweight") {
      info(`Mode lightweight: /api/feed?limit=${depth}`);
      const raw = await budget.get(`/api/feed?limit=${depth}`, "lightweight feed");
      allRawFetched.push(...raw);
      const filtered = filterPosts(raw, qualityFilter);
      updateCounters(counters, raw.length, filtered);
      allFiltered.push(...filtered);
      continue;
    }

    if (mode === "since-last") {
      const sinceArg = Number(flags["since"] || 0);
      const sinceMs = Number.isFinite(sinceArg) && sinceArg > 0
        ? sinceArg
        : (inferSinceFromSessionLog(config.paths.logFile) ?? (Date.now() - 24 * 60 * 60 * 1000));

      info(`Mode since-last: scanning posts since ${sinceMs}`);
      const recentRaw: any[] = [];
      for (let page = 0; page < 5; page++) {
        const offset = page * depth;
        const raw = await budget.get(`/api/feed?limit=${depth}&offset=${offset}`, `since-last page ${page + 1}`);
        allRawFetched.push(...raw);
        counters.totalFetched += raw.length;

        if (raw.length === 0) break;

        const timestamps = raw
          .map((p) => Number(p?.timestamp || 0))
          .filter((t) => Number.isFinite(t) && t > 0);
        const oldest = timestamps.length > 0 ? Math.min(...timestamps) : 0;

        for (const post of raw) {
          const ts = Number(post?.timestamp || 0);
          if (Number.isFinite(ts) && ts >= sinceMs) recentRaw.push(post);
        }

        if (raw.length < depth || (oldest > 0 && oldest < sinceMs)) break;
      }

      const filtered = filterPosts(recentRaw, qualityFilter);
      updateCounters(counters, 0, filtered);
      allFiltered.push(...filtered);
      sinceLastPosts = filtered.length;
      continue;
    }

    if (mode === "topic-search") {
      const topics = parseCsv(flags["topics"]);
      const topicQueries = topics.length > 0 ? topics : config.topics.secondary.slice(0, 3);
      const out: Record<string, TopicStatsJson> = {};

      // Strategy: /api/feed/search?text= only searches post body text, not tags.
      // Asset search works reliably. For tag-based topics, we fetch a broad page
      // and filter locally by tag/asset match.
      //
      // 1. Try asset= search (works for token symbols)
      // 2. Try text= search (works for words in post body)
      // 3. Fall back to broad feed scan with local tag matching
      //
      // We fetch one broad page up front (shared across all topic queries) to
      // amortize the API call cost for tag-based matching.

      let broadPool: any[] | null = null;

      for (const topic of topicQueries) {
        info(`Mode topic-search: ${topic}`);
        let topicPosts: FilteredPost[] = [];

        // Run asset + text search in parallel — independent calls, no data dependency.
        const searchResults = await Promise.allSettled([
          budget.get(
            `/api/feed/search?asset=${encodeURIComponent(topic)}&limit=${topicSearchLimit}`,
            `topic-search asset="${topic}"`
          ),
          budget.get(
            `/api/feed/search?text=${encodeURIComponent(topic)}&limit=${topicSearchLimit}`,
            `topic-search text="${topic}"`
          ),
        ]);
        for (const [i, result] of searchResults.entries()) {
          const label = i === 0 ? "asset" : "text";
          if (result.status === "fulfilled") {
            allRawFetched.push(...result.value);
            const filtered = filterPosts(result.value, qualityFilter);
            updateCounters(counters, result.value.length, filtered);
            topicPosts.push(...filtered);
          } else {
            info(`topic-search ${label}="${topic}" failed (${result.reason?.message || result.reason}), continuing`);
          }
        }

        // If both returned empty, scan broad feed for tag matches
        if (topicPosts.length === 0) {
          try {
            if (broadPool === null) {
              info("Topic-search: fetching broad feed for tag matching");
              broadPool = await budget.get(`/api/feed?limit=${depth}`, "topic-search broad pool");
              allRawFetched.push(...broadPool);
              counters.totalFetched += broadPool.length;
            }
            const topicLower = topic.toLowerCase();
            const tagMatches = broadPool.filter((p: any) => {
              const tags = (p.payload?.tags || []).map((t: string) => String(t).toLowerCase());
              const assets = (p.payload?.assets || []).map((a: string) => String(a).toLowerCase());
              return tags.some((t: string) => t.includes(topicLower) || topicLower.includes(t))
                || assets.some((a: string) => a.includes(topicLower) || topicLower.includes(a));
            });
            const tagFiltered = filterPosts(tagMatches, qualityFilter);
            updateCounters(counters, 0, tagFiltered); // already counted in broad fetch
            topicPosts.push(...tagFiltered);
          } catch (err: any) {
            info(`topic-search broad="${topic}" failed (${err?.message || err}), continuing`);
          }
        }

        // Dedupe by txHash within this topic
        const seen = new Set<string>();
        const deduped: FilteredPost[] = [];
        for (const p of topicPosts) {
          if (!seen.has(p.txHash)) {
            seen.add(p.txHash);
            deduped.push(p);
          }
        }

        allFiltered.push(...deduped);
        out[topic.toLowerCase()] = topicStatsFromPosts(deduped);
      }

      topicIndexOut = { ...(topicIndexOut || {}), ...out };
      continue;
    }

    if (mode === "category-filtered") {
      const categories = parseCsv(flags["categories"]);
      const requested = categories.length > 0 ? categories : ["QUESTION"];
      if (!categoryBreakdown) categoryBreakdown = {};

      for (const category of requested) {
        const upper = category.toUpperCase();
        const endpoint = `/api/feed?category=${encodeURIComponent(upper)}&limit=${depth}`;
        info(`Mode category-filtered: ${upper}`);
        const raw = await budget.get(endpoint, `category-filtered "${upper}"`);
        allRawFetched.push(...raw);
        const filtered = filterPosts(raw, qualityFilter);
        updateCounters(counters, raw.length, filtered);
        allFiltered.push(...filtered);
        categoryBreakdown[upper] = filtered.length;
      }
      continue;
    }

    if (mode === "quality-indexed") {
      const cacheDir = resolve(homedir(), ".demos-scan-cache");
      const cachePath = resolve(cacheDir, `${agentName}-quality-index.json`);
      const now = Date.now();
      const maxAgeMs = cacheHours * 60 * 60 * 1000;

      if (existsSync(cachePath)) {
        try {
          const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
          const generatedAt = Number(cached?.generatedAt || 0);
          if (generatedAt > 0 && now - generatedAt <= maxAgeMs) {
            info(`Mode quality-indexed: cache hit (${cachePath})`);
            topicIndexOut = cached.topicIndex || topicIndexOut;
            agentIndexOut = cached.agentIndex || agentIndexOut;
            continue;
          }
        } catch {
          // fall through to refresh
        }
      }

      info("Mode quality-indexed: building fresh index");
      const rawAll: any[] = [];
      for (let page = 0; page < 5; page++) {
        const offset = page * depth;
        const raw = await budget.get(`/api/feed?limit=${depth}&offset=${offset}`, `quality-indexed page ${page + 1}`);
        allRawFetched.push(...raw);
        counters.totalFetched += raw.length;
        rawAll.push(...raw);
        if (raw.length < depth) break;
      }

      const filtered = filterPosts(rawAll, qualityFilter);
      updateCounters(counters, 0, filtered);
      allFiltered.push(...filtered);

      const topicMap = buildTopicIndex(filtered);
      const agentMap = buildAgentIndex(filtered);
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
  const gaps = analyzeGaps(posts);
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
  console.error(`[room-temp] ERROR: ${err.message}`);
  process.exit(1);
});
