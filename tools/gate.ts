#!/usr/bin/env npx tsx
/**
 * Confidence Gate Checker — Sentinel Phase 2 tool
 *
 * Maps to strategy.yaml GATE phase (6+1 item checklist).
 * Automates checkable items, marks manual items as MANUAL in output.
 * No interactive prompts — pure CLI, fully agentic.
 *
 * Usage:
 *   npx tsx tools/gate.ts --topic TEXT [--text TEXT] [--category TEXT] [--confidence N] [--env PATH] [--pretty] [--json]
 */

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { connectWallet, apiCall, info } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";
import { resolveAgentName, loadAgentConfig } from "./lib/agent-config.js";

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
Confidence Gate Checker — Sentinel GATE phase tool

USAGE:
  npx tsx tools/gate.ts --topic TEXT [flags]

FLAGS:
  --agent NAME       Agent name (default: sentinel)
  --topic TEXT        Topic to check (required)
  --text TEXT         Post text to check length (optional)
  --category TEXT     Post category: ANALYSIS or PREDICTION (optional)
  --confidence N      Confidence value 0-100 (optional)
  --reply-to TX_HASH  Parent post txHash (checks reply target reactions)
  --scan-cache PATH   Path to session state JSON with scan rawPosts cache
  --env PATH          Path to .env file (default: .env in cwd)
  --pretty            Human-readable formatted output
  --json              Compact single-line JSON output
  --help, -h          Show this help

GATE ITEMS (from strategy.yaml):
  1. Topic activity ≥3 posts         [AUTO — search API, feed fallback]
  2. Unique data                     [MANUAL — operator confirms]
  3. Agent reference                 [MANUAL — operator confirms]
  4. ANALYSIS or PREDICTION category [AUTO — checks --category]
  5. >200 chars + confidence set     [AUTO — checks --text + --confidence]
  6. Not duplicate                   [AUTO — searches own posts]
  7. Reply target reactions           [AUTO — checks --reply-to parent, if provided]

EXAMPLES:
  npx tsx tools/gate.ts --topic "bitcoin" --pretty
  npx tsx tools/gate.ts --topic "oil-prices" --text "My analysis of..." --category ANALYSIS --confidence 85 --pretty
  npx tsx tools/gate.ts --topic "eth-staking" --json
`);
}

// ── Types ──────────────────────────────────────────

type GateStatus = "pass" | "fail" | "manual" | "warning";

interface GateItem {
  number: number;
  name: string;
  status: GateStatus;
  detail: string;
}

interface GateResult {
  timestamp: string;
  topic: string;
  items: GateItem[];
  summary: {
    pass: number;
    fail: number;
    manual: number;
    warning: number;
    total: number;
    recommendation: string;
  };
}

// ── Gate Checks ────────────────────────────────────

/**
 * Gate 1: Topic activity ≥3 posts in feed.
 * Uses cached scan posts if available, then search API, then feed fallback.
 */
async function checkTopicActivity(
  topic: string,
  token: string,
  cachedPosts?: any[]
): Promise<GateItem> {
  const topicLower = topic.toLowerCase();
  const validCache = Array.isArray(cachedPosts) ? cachedPosts : undefined;

  // Helper: client-side topic matching (tags, assets, text)
  const matchTopic = (posts: any[]) => posts.filter((p: any) => {
    const tags = (p.payload?.tags || []).map((t: string) => t.toLowerCase());
    const assets = (p.payload?.assets || []).map((a: string) => a.toLowerCase());
    const text = (p.payload?.text || "").toLowerCase();
    return tags.includes(topicLower) || assets.includes(topicLower) || text.includes(topicLower);
  });

  // Primary: search API — server-side text+asset filtering
  // Note: search `text` param may not match tags/assets. If search passes (≥3), trust it.
  // If search returns < 3 or fails, fall through to feed for client-side tag/asset matching.
  const searchRes = await apiCall(`/api/feed/search?text=${encodeURIComponent(topic)}&asset=${encodeURIComponent(topic)}&limit=10`, token);
  if (searchRes.ok) {
    const rawPosts = searchRes.data?.posts ?? searchRes.data;
    const posts = Array.isArray(rawPosts) ? rawPosts : [];
    if (posts.length >= 3) {
      return { number: 1, name: "Topic activity", status: "pass", detail: `${posts.length} posts found via search (threshold: 3)` };
    }
    // Search returned < 3 — fall through to feed for broader tag/asset matching
  }

  // Fallback: feed API with client-side filtering (search returned few results or is down)
  const feedRes = await apiCall(`/api/feed?limit=50`, token);
  if (!feedRes.ok) {
    const searchNote = searchRes.ok ? "search found < 3" : `search failed (${searchRes.status})`;
    // If we had cached scan data, use that instead of warning
    if (validCache) {
      const matching = matchTopic(validCache);
      return { number: 1, name: "Topic activity", status: matching.length >= 3 ? "pass" : "fail", detail: `${matching.length} posts via scan cache (API unavailable)` };
    }
    return { number: 1, name: "Topic activity", status: "warning", detail: `${searchNote}, feed failed (${feedRes.status}) — cannot verify` };
  }

  const rawPosts = feedRes.data?.posts ?? feedRes.data;
  const posts = Array.isArray(rawPosts) ? rawPosts : [];
  const matching = matchTopic(posts);

  const count = matching.length;
  if (count >= 3) {
    return { number: 1, name: "Topic activity", status: "pass", detail: `${count} posts found via feed fallback (threshold: 3)` };
  }
  return { number: 1, name: "Topic activity", status: "fail", detail: `${count} posts found via feed fallback (need ≥3)` };
}

/**
 * Gate 2: Unique data — MANUAL check.
 */
function checkUniqueData(): GateItem {
  return {
    number: 2,
    name: "Unique data",
    status: "manual",
    detail: "MANUAL — do you have data no one else has attested?",
  };
}

/**
 * Gate 3: Agent reference — MANUAL check.
 */
function checkAgentReference(): GateItem {
  return {
    number: 3,
    name: "Agent reference",
    status: "manual",
    detail: "MANUAL — which agent(s) will you cite?",
  };
}

/**
 * Gate 4: Category is ANALYSIS or PREDICTION.
 */
function checkCategory(category?: string): GateItem {
  if (!category) {
    return {
      number: 4,
      name: "Category",
      status: "warning",
      detail: "Not provided (use --category ANALYSIS or PREDICTION)",
    };
  }
  const upper = category.toUpperCase();
  if (upper === "ANALYSIS" || upper === "PREDICTION") {
    return {
      number: 4,
      name: "Category",
      status: "pass",
      detail: `${upper} (strategic policy compliance)`,
    };
  }
  return {
    number: 4,
    name: "Category",
    status: "fail",
    detail: `"${category}" is not ANALYSIS or PREDICTION`,
  };
}

/**
 * Gate 5: Text >200 chars + confidence set.
 */
function checkTextAndConfidence(text?: string, confidence?: string): GateItem {
  const issues: string[] = [];

  if (!text) {
    issues.push("text not provided (use --text)");
  } else if (text.length <= 200) {
    issues.push(`text is ${text.length} chars (need >200)`);
  }

  if (!confidence) {
    issues.push("confidence not provided (use --confidence)");
  } else {
    if (!/^\d+$/.test(confidence)) {
      issues.push(`confidence "${confidence}" invalid (need integer 0-100)`);
    } else {
      const val = Number(confidence);
      if (val < 0 || val > 100) {
        issues.push(`confidence ${val} out of range (need 0-100)`);
      }
    }
  }

  if (issues.length > 0) {
    if (!text && !confidence) {
      return { number: 5, name: "Text + confidence", status: "warning", detail: issues.join("; ") };
    }
    return { number: 5, name: "Text + confidence", status: "fail", detail: issues.join("; ") };
  }

  return {
    number: 5,
    name: "Text + confidence",
    status: "pass",
    detail: `${text!.length} chars, confidence ${confidence}`,
  };
}

/**
 * Gate 6: Not a duplicate of own recent posts.
 * Uses author feed (search API lacks author filter). Retries once on 502.
 */
async function checkDuplicate(
  topic: string,
  token: string,
  address: string
): Promise<GateItem> {
  // 502 retry handled by apiCall() — no manual retry needed
  const feedRes = await apiCall(`/api/feed?author=${address}&limit=50`, token);

  if (!feedRes.ok) {
    return { number: 6, name: "Not duplicate", status: "warning", detail: `Author feed failed (${feedRes.status}) — cannot verify` };
  }

  const rawPosts = feedRes.data?.posts ?? feedRes.data;
  const posts = Array.isArray(rawPosts) ? rawPosts : [];
  const topicLower = topic.toLowerCase();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const duplicates = posts.filter((p: any) => {
    const tags = (p.payload?.tags || []).map((t: string) => t.toLowerCase());
    const assets = (p.payload?.assets || []).map((a: string) => a.toLowerCase());
    const text = (p.payload?.text || "").toLowerCase();
    return tags.includes(topicLower) || assets.includes(topicLower) || text.includes(topicLower);
  });

  // Only recent duplicates (last 24h) are hard failures — older matches are informational
  const recentDuplicates = duplicates.filter((p: any) => {
    const ts = Number(p.timestamp || p.createdAt || 0);
    // SuperColony timestamps are Unix ms
    return ts > oneDayAgo;
  });

  if (duplicates.length === 0) {
    return { number: 6, name: "Not duplicate", status: "pass", detail: "No matching posts found in your history" };
  }

  if (recentDuplicates.length === 0) {
    return { number: 6, name: "Not duplicate", status: "pass", detail: `${duplicates.length} older post(s) match topic "${topic}" but none in last 24h` };
  }

  return { number: 6, name: "Not duplicate", status: "fail", detail: `${recentDuplicates.length} post(s) in last 24h match topic "${topic}" — too recent to repeat` };
}

/**
 * Gate 7: Reply target has enough reactions (uses config.engagement.replyMinParentReactions).
 * Only runs when --reply-to is provided.
 */
async function checkReplyTarget(
  replyTo: string,
  token: string,
  minReactions: number
): Promise<GateItem> {
  const threadRes = await apiCall(`/api/feed/thread/${replyTo}`, token);
  if (!threadRes.ok) {
    return { number: 7, name: "Reply target", status: "warning", detail: `Cannot fetch parent post ${replyTo.slice(0, 8)}... (${threadRes.status})` };
  }

  // Thread response may be the post itself, contain .post, or have a .posts array
  let post = threadRes.data?.post || threadRes.data;
  if (!post || post.txHash !== replyTo) {
    // Check posts array (same pattern as audit.ts)
    const threadPosts = threadRes.data?.posts;
    if (Array.isArray(threadPosts)) {
      post = threadPosts.find((p: any) => p.txHash === replyTo);
    }
  }
  if (!post || post.txHash !== replyTo) {
    return { number: 7, name: "Reply target", status: "warning", detail: `Parent post ${replyTo.slice(0, 8)}... not found in thread response` };
  }

  const reactions = (post.reactions?.agree || 0) + (post.reactions?.disagree || 0);
  if (reactions >= minReactions) {
    return { number: 7, name: "Reply target", status: "pass", detail: `Parent has ${reactions} reactions (threshold: ${minReactions})` };
  }

  return { number: 7, name: "Reply target", status: "fail", detail: `Parent has ${reactions} reactions (need ≥${minReactions})` };
}

// ── Pretty Output ──────────────────────────────────

function prettyPrint(result: GateResult): void {
  console.log(`\nGATE — Confidence Checklist for "${result.topic}"\n`);

  for (const item of result.items) {
    let icon: string;
    switch (item.status) {
      case "pass": icon = "✅"; break;
      case "fail": icon = "❌"; break;
      case "manual": icon = "❓"; break;
      case "warning": icon = "⚠️ "; break;
    }
    console.log(`  ${icon} ${item.number}. ${item.name}: ${item.detail}`);
  }

  const s = result.summary;
  console.log(`\n  RESULT: ${s.pass}/${s.total} pass, ${s.fail} fail, ${s.manual} manual, ${s.warning} warning`);
  console.log(`  ${s.recommendation}\n`);
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  const config = loadAgentConfig(agentName);
  const topic = flags["topic"];
  if (!topic) {
    console.error("[gate] ERROR: --topic is required");
    process.exit(1);
  }

  const envPath = flags["env"] || resolve(process.cwd(), ".env");
  const text = flags["text"];
  const category = flags["category"];
  const confidence = flags["confidence"];
  const replyTo = flags["reply-to"];
  const scanCachePath = flags["scan-cache"];

  // Load cached scan posts if available
  let cachedPosts: any[] | undefined;
  if (scanCachePath) {
    try {
      const stateData = JSON.parse(readFileSync(resolve(scanCachePath), "utf-8"));
      cachedPosts = stateData?.phases?.scan?.result?.rawPosts;
      if (cachedPosts) {
        info(`Loaded ${cachedPosts.length} cached posts from scan phase`);
      }
    } catch {
      info("Could not load scan cache — will use API only");
    }
  }

  // Connect and auth
  const { demos, address } = await connectWallet(envPath);
  const token = await ensureAuth(demos, address);

  // Run gate checks
  info("Running gate checks...");
  const items: GateItem[] = [];

  // Parallel API checks + sync checks
  const apiChecks: Promise<GateItem>[] = [
    checkTopicActivity(topic, token, cachedPosts),
    checkDuplicate(topic, token, address),
  ];
  if (replyTo) {
    apiChecks.push(checkReplyTarget(replyTo, token, config.engagement.replyMinParentReactions));
  }
  const [topicActivity, duplicate, replyTarget] = await Promise.all(apiChecks);

  items.push(topicActivity);
  items.push(checkUniqueData());
  items.push(checkAgentReference());
  items.push(checkCategory(category));
  items.push(checkTextAndConfidence(text, confidence));
  items.push(duplicate);
  if (replyTarget) {
    items.push(replyTarget);
  }

  // Summary
  const pass = items.filter(i => i.status === "pass").length;
  const fail = items.filter(i => i.status === "fail").length;
  const manual = items.filter(i => i.status === "manual").length;
  const warning = items.filter(i => i.status === "warning").length;

  let recommendation: string;
  const autoCheckable = items.filter(i => i.status !== "manual");
  const autoPass = autoCheckable.filter(i => i.status === "pass").length;
  const autoTotal = autoCheckable.length;

  if (fail >= 2) {
    recommendation = `HOLD — ${fail} checks failed. Don't publish — wait for better conditions.`;
  } else if (fail === 1) {
    recommendation = `REVIEW — 1 check failed. Evaluate if borderline and publish if justified.`;
  } else if (warning > 0 && autoPass < autoTotal) {
    recommendation = `REVIEW — ${warning} check(s) need data. Provide missing flags for full evaluation.`;
  } else if (autoPass === autoTotal) {
    recommendation = `GO — all automated checks pass. Confirm ${manual} manual item(s) and publish.`;
  } else {
    recommendation = `REVIEW — ${autoPass}/${autoTotal} automated checks pass.`;
  }

  const result: GateResult = {
    timestamp: new Date().toISOString(),
    topic,
    items,
    summary: { pass, fail, manual, warning, total: items.length, recommendation },
  };

  // Output
  if (flags["pretty"] === "true") {
    prettyPrint(result);
  } else if (flags["json"] === "true") {
    console.log(JSON.stringify(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error(`[gate] ERROR: ${err.message}`);
  process.exit(1);
});
