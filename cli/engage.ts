#!/usr/bin/env npx tsx
/**
 * Engagement Automation — Sentinel Phase 3 tool
 *
 * Maps to strategy.yaml ENGAGE phase (reactions only).
 * Fetches feed, selects reaction targets using heuristics, casts reactions.
 * Reply threads remain manual — automating reply content requires persona judgment.
 *
 * Uses tools/lib/ shared code instead of inline setup (unlike react-to-posts.ts).
 * Outputs structured JSON (composable) instead of console.log.
 *
 * Usage:
 *   npx tsx tools/engage.ts [--max N] [--env PATH] [--pretty] [--json]
 *
 * Examples:
 *   npx tsx tools/engage.ts --max 5 --pretty
 *   npx tsx tools/engage.ts --max 3 --json
 */

import { resolve } from "node:path";
import { connectWallet, apiCall, info, setLogAgent } from "../src/lib/sdk.js";
import { ensureAuth } from "../src/lib/auth.js";
import { resolveAgentName, loadAgentConfig } from "../src/lib/agent-config.js";
import { selectReaction, enforceDisagreeMinimum } from "../src/lib/engage-heuristics.js";

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
Engagement Automation — Sentinel ENGAGE phase tool (reactions only)

USAGE:
  npx tsx tools/engage.ts [flags]

FLAGS:
  --agent NAME      Agent name (default: sentinel)
  --max N           Max reactions to cast (default: from agent config, range: 1-20)
  --env PATH        Path to .env file (default: .env in cwd)
  --pretty          Human-readable formatted output
  --json            Compact single-line JSON output
  --help, -h        Show this help

REACTION HEURISTICS:
  hard skip: score < 70
  agree:     attested + score ≥80
  agree:     attested + score ≥70 + category ANALYSIS/PREDICTION
  disagree:  unattested + score ≥70 + numeric claim detected
  skip:      everything else

EXAMPLES:
  npx tsx tools/engage.ts --max 5 --pretty
  npx tsx tools/engage.ts --max 3 --json
  npx tsx tools/engage.ts --env ~/projects/DEMOS-Work/.env --pretty
`);
}

// ── Types ──────────────────────────────────────────

interface ReactionTarget {
  txHash: string;
  author: string;
  reaction: "agree" | "disagree";
  topic: string;
  score: number;
  reason: string;
}

interface EngageOutput {
  timestamp: string;
  reactions_cast: number;
  agrees: number;
  disagrees: number;
  targets: ReactionTarget[];
  skipped: number;
  errors: number;
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const config = loadAgentConfig(agentName);
  const envPath = resolve(flags.env || ".env");
  const pretty = flags.pretty === "true";
  const jsonMode = flags.json === "true";
  const qualityFloor = Math.max(70, config.scan.qualityFloor);

  // Default to agent config, allow CLI override
  let maxReactions = config.engagement.maxReactionsPerSession;
  if (flags.max !== undefined) {
    if (!/^\d+$/.test(flags.max)) {
      console.error(`Error: --max must be a positive integer, got "${flags.max}"`);
      process.exit(1);
    }
    const parsed = Number(flags.max);
    if (parsed < 1 || parsed > 20) {
      console.error(`Error: --max must be between 1 and 20, got ${parsed}`);
      process.exit(1);
    }
    maxReactions = parsed;
  }

  // Connect and authenticate
  info("Connecting wallet...");
  const { demos, address } = await connectWallet(envPath);
  const token = await ensureAuth(demos, address);

  // Fetch feed
  info("Fetching feed...");
  const feedRes = await apiCall("/api/feed?limit=50", token);
  if (!feedRes.ok) {
    console.error(`Failed to fetch feed: ${feedRes.status}`);
    process.exit(1);
  }

  const allPosts = feedRes.data?.posts ?? feedRes.data ?? [];
  if (!Array.isArray(allPosts)) {
    console.error("Unexpected feed response format");
    process.exit(1);
  }

  info(`Feed: ${allPosts.length} posts`);

  // Select and cast reactions
  const targets: ReactionTarget[] = [];
  let skipped = 0;
  let errors = 0;
  let agrees = 0;
  let disagrees = 0;
  const processedTxHashes = new Set<string>();

  for (const post of allPosts) {
    if (agrees + disagrees >= maxReactions) break;

    const decision = selectReaction(post, address, qualityFloor);
    if (!decision) {
      skipped++;
      continue;
    }

    processedTxHashes.add(post.txHash);

    // Cast reaction via API
    const res = await apiCall(`/api/feed/${encodeURIComponent(post.txHash)}/react`, token, {
      method: "POST",
      body: JSON.stringify({ type: decision.reaction }),
    });

    if (res.ok) {
      const topic =
        post.payload?.tags?.[0] ||
        post.payload?.topic ||
        post.payload?.cat ||
        "unknown";

      targets.push({
        txHash: post.txHash,
        author: (post.author || "").slice(0, 16),
        reaction: decision.reaction,
        topic,
        score: post.score ?? post.qualityScore ?? 0,
        reason: decision.reason,
      });

      if (decision.reaction === "agree") agrees++;
      else disagrees++;

      info(
        `${decision.reaction === "agree" ? "👍" : "👎"} ${decision.reaction.toUpperCase()} ${post.txHash.slice(0, 12)}... (${decision.reason})`
      );
    } else {
      info(`⚠️ Failed to react on ${post.txHash.slice(0, 12)}...: ${res.status}`);
      errors++;
    }

    // Respectful rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // Second pass: enforce minDisagreePerSession
  const minDisagree = config.engagement.minDisagreePerSession || 0;
  if (minDisagree > 0 && disagrees < minDisagree) {
    const remainingPosts = allPosts.filter((p: any) => !processedTxHashes.has(p.txHash));
    const additionalTargets = enforceDisagreeMinimum({
      remainingPosts,
      currentDisagrees: disagrees,
      minDisagreePerSession: minDisagree,
      ourAddress: address,
      qualityFloor,
    });

    for (const target of additionalTargets) {
      const post = remainingPosts.find((p: any) => p.txHash === target.txHash);
      if (!post) continue;

      const res = await apiCall(`/api/feed/${encodeURIComponent(target.txHash)}/react`, token, {
        method: "POST",
        body: JSON.stringify({ type: "disagree" }),
      });

      if (res.ok) {
        const topic =
          post.payload?.tags?.[0] ||
          post.payload?.topic ||
          post.payload?.cat ||
          "unknown";

        targets.push({
          txHash: target.txHash,
          author: (post.author || "").slice(0, 16),
          reaction: "disagree",
          topic,
          score: post.score ?? post.qualityScore ?? 0,
          reason: target.reason,
        });
        disagrees++;

        info(`👎 DISAGREE ${target.txHash.slice(0, 12)}... (${target.reason})`);
      } else {
        info(`⚠️ Failed to react on ${target.txHash.slice(0, 12)}...: ${res.status}`);
        errors++;
      }

      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Build output
  const output: EngageOutput = {
    timestamp: new Date().toISOString(),
    reactions_cast: agrees + disagrees,
    agrees,
    disagrees,
    targets,
    skipped,
    errors,
  };

  // Format output
  if (pretty) {
    console.log("\n" + "═".repeat(60));
    console.log(`  ${agentName.toUpperCase()} — Engagement (max: ${maxReactions})`);
    console.log("═".repeat(60));

    for (const t of targets) {
      const icon = t.reaction === "agree" ? "👍" : "👎";
      console.log(
        `  ${icon} ${t.reaction.toUpperCase()} ${t.txHash.slice(0, 16)}... | ${t.author}... | ${t.topic} | ${t.reason}`
      );
    }

    console.log(
      `\n  Done: ${agrees} agrees, ${disagrees} disagrees, ${skipped} skipped, ${errors} errors`
    );
    if (disagrees === 0 && agrees > 0) {
      console.log(
        "  ⚠️ No disagrees cast — no posts qualified for disagree heuristic"
      );
    }
    console.log("═".repeat(60));
  } else if (jsonMode) {
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
