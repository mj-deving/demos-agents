#!/usr/bin/env npx tsx
/**
 * Event Runner — long-lived process for reactive event handling.
 *
 * Runs alongside the cron-based session-runner.ts.
 * Polls SuperColony feed for replies, mentions, tips, and disagrees.
 * Dispatches to pure handlers that return EventActions.
 *
 * Process model: managed by systemd/pm2. NOT a cron job.
 *
 * Usage:
 *   npx tsx tools/event-runner.ts --agent sentinel [--dry-run] [--pretty]
 *
 * Budget: reactive posts are rate-limited separately from cron.
 *   Default: 4 reactive posts/day (configured in persona.yaml events.budget.dailyReactive)
 *
 * WS4: SuperColony Reactive Mode.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

import { resolveAgentName, loadAgentConfig } from "./lib/agent-config.js";
import { connectWallet, setLogAgent, apiCall, info, warn } from "./lib/sdk.js";
import { ensureAuth, loadAuthCache } from "./lib/auth.js";
import { initObserver, observe } from "./lib/observe.js";
import { loadWriteRateLedger, canPublish, recordPublish, saveWriteRateLedger } from "./lib/write-rate-limit.js";
import { attestAndPublish, type PublishInput } from "./lib/publish-pipeline.js";
import { generatePost, type GeneratePostInput } from "./lib/llm.js";
import { createActionExecutor, type ActionExecutorContext } from "./lib/action-executor.js";
import { resolveProvider } from "./lib/llm-provider.js";
import { createFileWatermarkStore } from "./lib/watermark-store.js";
import { startEventLoop, type SourceRegistration } from "./lib/event-loop.js";

import { createSocialReplySource, type ReplyPost } from "./lib/event-sources/social-replies.js";
import { createSocialMentionSource, type MentionPost } from "./lib/event-sources/social-mentions.js";
import { createTipReceivedSource, type TipRecord } from "./lib/event-sources/tip-received.js";
import {
  createDisagreeMonitorSource,
  type DisagreePost,
} from "./lib/event-sources/disagree-monitor.js";

import { createReplyHandler } from "./lib/event-handlers/reply-handler.js";
import { createMentionHandler } from "./lib/event-handlers/mention-handler.js";
import { createTipThanksHandler } from "./lib/event-handlers/tip-thanks-handler.js";
import { createDisagreeHandler } from "./lib/event-handlers/disagree-handler.js";

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import type { AgentEvent, EventAction, EventHandler } from "../core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Arg Parsing ────────────────────────────────────

interface EventRunnerFlags {
  agent: string;
  env: string;
  dryRun: boolean;
  pretty: boolean;
}

function parseFlags(): EventRunnerFlags {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
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

  const agentName = resolveAgentName(flags);
  return {
    agent: agentName,
    env: flags.env || "",
    dryRun: flags["dry-run"] === "true",
    pretty: flags.pretty === "true",
  };
}

// ── Feed Helpers ───────────────────────────────────

function normalizePosts(payload: any): any[] {
  const posts =
    payload?.posts ??
    payload?.results ??
    payload?.items ??
    payload?.data?.posts ??
    payload?.data ??
    payload ??
    [];
  return Array.isArray(posts) ? posts : [];
}

async function fetchFeedPosts(token: string, limit: number = 50): Promise<any[]> {
  const res = await apiCall(`/api/feed?limit=${limit}`, token);
  if (!res.ok) return [];
  return normalizePosts(res.data);
}

// Shared feed cache — prevents 4 identical API calls when sources poll simultaneously
let feedCache: { posts: any[]; fetchedAt: number } | null = null;
const FEED_CACHE_TTL_MS = 10_000; // 10 seconds

async function fetchFeedCached(token: string): Promise<any[]> {
  if (feedCache && Date.now() - feedCache.fetchedAt < FEED_CACHE_TTL_MS) {
    return feedCache.posts;
  }
  const posts = await fetchFeedPosts(token);
  feedCache = { posts, fetchedAt: Date.now() };
  return posts;
}

// ── Session Log Reader ─────────────────────────────

/**
 * Load TX hashes from the session log. Each line is a JSONL entry
 * with a txHash field for published posts.
 */
function loadOwnTxHashes(agentName: string): Set<string> {
  const logPath = resolve(homedir(), `.${agentName}-session-log.jsonl`);
  const hashes = new Set<string>();
  if (!existsSync(logPath)) return hashes;

  try {
    const lines = readFileSync(logPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry.txHash && typeof entry.txHash === "string") {
          hashes.add(entry.txHash);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Log file unreadable — return empty set
  }
  return hashes;
}

// ── Auth Token Refresh ────────────────────────────

/**
 * Check if auth token is still valid (>5 min remaining).
 * Re-authenticates if expired.
 */
async function refreshTokenIfNeeded(
  demos: Demos,
  address: string,
  currentToken: string,
): Promise<string> {
  const cached = loadAuthCache(address);
  if (cached) return cached.token; // Still valid

  info("[event] Auth token expired, re-authenticating...");
  return await ensureAuth(demos, address, true);
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags();
  setLogAgent(flags.agent);
  const config = loadAgentConfig(flags.agent);

  info("Event runner starting...");
  info(`Agent: ${flags.agent}, dry-run: ${flags.dryRun}`);

  // Connect wallet and authenticate
  const { demos, address } = await connectWallet(flags.env);
  let token = await ensureAuth(demos, address);

  // Initialize observer for event logging
  initObserver(flags.agent, -1); // -1 = event loop session

  // Watermark store
  const store = createFileWatermarkStore(flags.agent);

  // Budget config from persona.yaml (defaults)
  const dailyReactive = (config as any).events?.budget?.dailyReactive ?? 4;

  // Resolve LLM provider once at startup (avoids file reads + subprocess forks per reply)
  const llm = resolveProvider(flags.env || undefined);
  if (!llm) {
    warn("No LLM provider available — reply actions will be skipped");
  } else {
    info(`LLM provider: ${llm.name}`);
  }

  // Track agent's published TX hashes (loaded from session log)
  const ownTxHashes = loadOwnTxHashes(flags.agent);
  info(`Loaded ${ownTxHashes.size} own TX hashes from session log`);

  // ── Create Sources ─────────────────────────────

  const replySrc = createSocialReplySource({
    fetchFeed: async () => {
      const posts = await fetchFeedCached(token);
      return posts.map((p: any): ReplyPost => ({
        txHash: String(p?.txHash || ""),
        author: String(p?.author || p?.address || "").toLowerCase(),
        timestamp: Number(p?.timestamp || 0),
        text: String(p?.payload?.text || p?.text || ""),
        replyTo: String(p?.payload?.replyTo || p?.replyTo || ""),
      })).filter((p: ReplyPost) => p.txHash && p.replyTo);
    },
    ownTxHashes: () => ownTxHashes,
  });

  const mentionSrc = createSocialMentionSource({
    fetchFeed: async () => {
      const posts = await fetchFeedCached(token);
      return posts.map((p: any): MentionPost => ({
        txHash: String(p?.txHash || ""),
        author: String(p?.author || p?.address || "").toLowerCase(),
        timestamp: Number(p?.timestamp || 0),
        text: String(p?.payload?.text || p?.text || ""),
      })).filter((p: MentionPost) => p.txHash);
    },
    agentAddress: address,
  });

  const tipSrc = createTipReceivedSource({
    fetchTips: async () => {
      // Filter feed for tip transactions to this agent
      const posts = await fetchFeedCached(token);
      return posts
        .filter((p: any) => {
          const tipTo = String(p?.payload?.tipTo || p?.tipTo || "").toLowerCase();
          return tipTo === address.toLowerCase() && p?.payload?.tipAmount;
        })
        .map((p: any): TipRecord => ({
          txHash: String(p?.txHash || ""),
          from: String(p?.author || p?.address || "").toLowerCase(),
          amount: Number(p?.payload?.tipAmount || 0),
          timestamp: Number(p?.timestamp || 0),
        }))
        .filter((t: TipRecord) => t.txHash && t.amount > 0);
    },
  });

  const disagreeSrc = createDisagreeMonitorSource({
    fetchOwnPosts: async () => {
      // Filter feed for agent's own posts, compute disagree ratios
      const posts = await fetchFeedCached(token);
      return posts
        .filter((p: any) => {
          const author = String(p?.author || p?.address || "").toLowerCase();
          return author === address.toLowerCase();
        })
        .map((p: any): DisagreePost => {
          const agree = Number(p?.reactions?.agree || 0);
          const disagree = Number(p?.reactions?.disagree || 0);
          const total = agree + disagree;
          return {
            txHash: String(p?.txHash || ""),
            timestamp: Number(p?.timestamp || 0),
            text: String(p?.payload?.text || p?.text || ""),
            agreeCount: agree,
            disagreeCount: disagree,
            disagreeRatio: total > 0 ? disagree / total : 0,
          };
        })
        .filter((p: DisagreePost) => p.txHash);
    },
    disagreeThreshold: 0.3,
  });

  // ── Create Handlers ────────────────────────────

  const handlers: EventHandler[] = [
    createReplyHandler(),
    createMentionHandler(),
    createTipThanksHandler(),
    createDisagreeHandler(),
  ];

  // ── Source Registrations ───────────────────────

  const sources: SourceRegistration[] = [
    { source: replySrc, intervalMs: 30_000, minIntervalMs: 15_000, maxIntervalMs: 300_000 },
    { source: mentionSrc, intervalMs: 60_000, minIntervalMs: 30_000, maxIntervalMs: 600_000 },
    { source: tipSrc, intervalMs: 120_000, minIntervalMs: 60_000, maxIntervalMs: 900_000 },
    { source: disagreeSrc, intervalMs: 300_000, minIntervalMs: 120_000, maxIntervalMs: 900_000 },
  ];

  // ── Action Executor (extracted to tools/lib/action-executor.ts) ────

  const executorCtx: ActionExecutorContext = {
    agentName: flags.agent,
    address,
    dryRun: flags.dryRun,
    getToken: async () => {
      token = await refreshTokenIfNeeded(demos, address, token);
      return token;
    },
    dailyReactive,
    hourlyReactive: 2,
    calibrationOffset: config.calibration.offset,
    personaMdPath: config.paths.personaMd,
    strategyYamlPath: config.paths.strategyYaml,
    llm,
    ownTxHashes,
    apiCall,
    generatePost,
    attestAndPublish: (input, url, opts) => attestAndPublish(demos, input, url, opts),
    transfer: (recipient, amount, memo) => (demos.transfer as any)(recipient, amount, memo),
    loadWriteRateLedger,
    canPublish,
    recordPublish,
    saveWriteRateLedger,
    observe,
    info,
    warn,
  };
  const executeAction = createActionExecutor(executorCtx);

  // ── Start Loop ─────────────────────────────────

  const loop = startEventLoop(
    { agent: flags.agent },
    sources,
    handlers,
    store,
    executeAction,
    (event, error) => {
      warn(`[event-error] ${event.sourceId}: ${error.message}`);
      observe("failure", `Event handler error: ${error.message}`, {
        phase: "event-loop",
        source: `event-runner:${event.sourceId}`,
        data: { eventId: event.id, error: error.message },
      });
    },
  );

  info("Event loop started. Press Ctrl+C to stop.");
  info(`Sources: ${sources.map(s => s.source.id).join(", ")}`);
  info(`Handlers: ${handlers.map(h => h.name).join(", ")}`);
  info(`Reactive budget: ${dailyReactive}/day`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    info(`Received ${signal}, shutting down...`);
    await loop.stop();
    const stats = loop.stats();
    info(`Final stats: ${stats.totalEvents} events, ${stats.totalActions} actions, ${stats.totalErrors} errors`);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`[event-runner] Fatal: ${err.message}`);
  process.exit(1);
});
