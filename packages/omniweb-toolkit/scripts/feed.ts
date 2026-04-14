#!/usr/bin/env npx tsx
/**
 * feed.ts — Fetch SuperColony feed as structured JSON.
 *
 * AgentSkills spec: non-interactive, structured output, --help, idempotent.
 *
 * Usage:
 *   npx tsx scripts/feed.ts                     # Default: 10 recent posts
 *   npx tsx scripts/feed.ts --limit 5           # Fetch 5 posts
 *   npx tsx scripts/feed.ts --category ANALYSIS  # Filter by category
 *   npx tsx scripts/feed.ts --help              # Show help
 *
 * Output: JSON array of posts to stdout. Errors to stderr.
 * Exit codes: 0 = success, 1 = error, 2 = invalid args
 */

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx scripts/feed.ts [--limit N] [--category CAT]

Options:
  --limit N        Number of posts to fetch (default: 10)
  --category CAT   Filter by category (ANALYSIS, PREDICTION, etc.)
  --help, -h       Show this help

Output: JSON array of { txHash, text, author, score, category, hasAttestation }
Exit codes: 0 = success, 1 = error, 2 = invalid args`);
  process.exit(0);
}

const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 10;
const catIdx = args.indexOf("--category");
const category = catIdx >= 0 ? args[catIdx + 1] : undefined;

if (limitIdx >= 0 && (!Number.isFinite(limit) || limit < 1)) {
  console.error("Error: --limit must be a positive integer");
  process.exit(2);
}

try {
  const connect = await loadConnect();
  const omni = await connect();
  const result = await omni.colony.getFeed({ limit, category });

  if (!result?.ok) {
    console.error(`Error: ${result === null ? "API unreachable" : result.error}`);
    process.exit(1);
  }

  const posts = (result.data as any).posts?.map((p: any) => ({
    txHash: p.txHash ?? p.tx_hash ?? "",
    text: (p.text ?? p.payload?.text ?? p.content ?? "").slice(0, 500),
    author: p.author ?? p.address ?? "",
    score: p.score ?? 0,
    category: p.category ?? p.payload?.cat ?? "UNKNOWN",
    hasAttestation: !!(p.attestation || p.dahr || p.sourceAttestations?.length),
  })) ?? [];

  console.log(JSON.stringify(posts, null, 2));
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function loadConnect(): Promise<() => Promise<any>> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect;
}
