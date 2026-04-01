#!/usr/bin/env npx tsx
/**
 * Colony Backfill — one-time CLI for full chain history ingestion.
 *
 * Paginates backward through chain transactions, decodes HIVE posts,
 * and batch-inserts into the colony cache DB. Uses a separate
 * `backfill_cursor` to avoid conflicting with the V3 loop's `cursor`.
 *
 * Usage:
 *   npx tsx cli/backfill-colony.ts --agent sentinel [--limit 5000] [--batch-size 1000] [--env .env] [--dry-run] [--reset-cursor]
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { connectWallet, info, setLogAgent } from "../src/lib/network/sdk.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../src/toolkit/sdk-bridge.js";
import { resolveAgentName } from "../src/lib/agent-config.js";
import { initColonyCache } from "../src/toolkit/colony/schema.js";
import { backfillFromTransactions, type BackfillRpc } from "../src/toolkit/colony/backfill.js";
import { toErrorMessage } from "../src/lib/util/errors.js";

// ── Arg Parsing ─────────────────────────────────────

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
Colony Backfill — one-time chain history ingestion

USAGE:
  npx tsx cli/backfill-colony.ts [flags]

FLAGS:
  --agent NAME        Agent name (default: sentinel)
  --limit N           Maximum posts to ingest (default: 5000)
  --batch-size N      Transactions per RPC page (default: 1000)
  --env PATH          Path to .env file (default: .env in cwd)
  --dry-run           Decode and count without writing to DB
  --reset-cursor      Ignore saved cursor and start from latest
  --help, -h          Show this help

EXAMPLES:
  npx tsx cli/backfill-colony.ts --agent sentinel
  npx tsx cli/backfill-colony.ts --agent sentinel --limit 500 --dry-run
  npx tsx cli/backfill-colony.ts --agent sentinel --reset-cursor --batch-size 2000
`);
}

// ── Main ────────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);

  const envPath = resolve(flags.env ?? ".env");
  const limit = flags.limit ? Number(flags.limit) : 5000;
  const batchSize = flags["batch-size"] ? Number(flags["batch-size"]) : 1000;
  const dryRun = flags["dry-run"] === "true";
  const resetCursor = flags["reset-cursor"] === "true";

  if (!Number.isFinite(limit) || limit <= 0) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    console.error("Error: --batch-size must be a positive integer");
    process.exit(1);
  }

  // Connect wallet — chain-only, no API auth needed
  info("Connecting wallet...");
  const { demos } = await connectWallet(envPath);
  const bridge = createSdkBridge(
    demos,
    undefined,
    AUTH_PENDING_TOKEN,
    globalThis.fetch,
    undefined,
    { allowRawSdk: true },
  );

  // Open colony DB
  const dbDir = resolve(homedir(), `.${agentName}`, "colony");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = resolve(dbDir, "cache.db");
  const db = initColonyCache(dbPath);

  // Get raw SDK for uncapped getTransactions pagination
  const rawDemos = bridge.getDemos();
  const rpc = rawDemos as unknown as BackfillRpc;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${agentName.toUpperCase()} — Colony Backfill`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Limit: ${limit} | Batch: ${batchSize} | Dry-run: ${dryRun}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const stats = await backfillFromTransactions(db, rpc, {
      batchSize,
      limit,
      dryRun,
      resetCursor,
      onProgress: (s) => {
        info(
          `Progress: ${s.inserted} inserted, ${s.deadLettered} dead-lettered, ${s.pagesScanned} pages scanned`,
        );
      },
    });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Backfill Complete`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Posts inserted:    ${stats.inserted}`);
    console.log(`  Skipped:           ${stats.skipped}`);
    console.log(`  Dead-lettered:     ${stats.deadLettered}`);
    console.log(`  Total scanned:     ${stats.totalScanned}`);
    console.log(`  Pages scanned:     ${stats.pagesScanned}`);
    console.log(`  Last block:        ${stats.lastBlockNumber ?? "N/A"}`);
    if (dryRun) {
      console.log(`  Mode:              DRY RUN (no data written)`);
    }
    console.log(`${"=".repeat(60)}\n`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("Error:", toErrorMessage(err));
  process.exit(1);
});
