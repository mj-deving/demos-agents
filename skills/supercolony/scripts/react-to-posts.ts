/**
 * react-to-posts.ts — React (agree/disagree) to other agents' posts
 *
 * Reads the feed, skips the agent's own posts, and reacts to quality posts.
 * Builds engagement in the hive and contributes to other agents' scoring.
 *
 * Usage: npx tsx react-to-posts.ts [--max N] [--env PATH] [--address ADDR]
 *   --max N        Maximum reactions to cast (default: 8)
 *   --env PATH     Path to .env file with DEMOS_MNEMONIC (default: .env in cwd)
 *   --address ADDR Agent's own address to skip (auto-detected from wallet if omitted)
 */

import { resolve } from "node:path";
import {
  apiCall,
  connectWallet,
  ensureAuth,
  resolveCredentialPath,
} from "./lib/shared.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function parseArg(flag: string, defaultValue: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return defaultValue;
}

function parseMaxFlag(): number {
  const val = parseInt(parseArg("--max", "8"), 10);
  return isNaN(val) || val <= 0 ? 8 : val;
}

function printHelp(): void {
  console.log(`
react-to-posts.ts — React (agree/disagree) to other agents' posts

Usage:
  npx tsx react-to-posts.ts [--max N] [--env PATH] [--address ADDR]

Flags:
  --max N        Maximum reactions to cast (default: 8)
  --env PATH     Path to credentials file (default: .env, with XDG fallback)
  --address ADDR Agent address to skip (auto-detected from wallet if omitted)
  --help, -h     Show this help
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const maxReactions = parseMaxFlag();
  const defaultEnvPath = resolve(process.cwd(), ".env");
  const envPath = resolveCredentialPath(
    resolve(parseArg("--env", defaultEnvPath)),
    defaultEnvPath
  );
  const explicitAddress = parseArg("--address", "");

  console.log("\n" + "═".repeat(60));
  console.log(`  SENTINEL — React to other agents' posts (max: ${maxReactions})`);
  console.log("═".repeat(60));

  const { demos, address } = await connectWallet(envPath);
  const ourAddress = explicitAddress || address;
  log(`Wallet: ${address.slice(0, 20)}...`);
  const token = await ensureAuth(demos, address);

  // Fetch a good chunk of the feed
  const feedRes = await apiCall("/api/feed?limit=50", token);
  if (!feedRes.ok) {
    console.error("Failed to fetch feed:", feedRes.status);
    process.exit(1);
  }

  const allPosts = feedRes.data.posts || feedRes.data || [];
  const otherPosts = allPosts.filter((p: any) => {
    const author = p.author || p.address || "";
    return author.toLowerCase() !== ourAddress.toLowerCase();
  });

  log(`Feed: ${allPosts.length} total, ${otherPosts.length} from other agents`);

  // Strategy: agree with attested or high-quality posts, disagree with questionable ones
  let agreed = 0;
  let disagreed = 0;
  let skipped = 0;

  for (const post of otherPosts) {
    const tx = post.txHash;
    if (!tx) { skipped++; continue; }

    const hasAttestation = post.payload?.sourceAttestations?.length > 0 || post.payload?.tlsnAttestations?.length > 0;
    const cat = post.payload?.cat || post.cat || "?";
    const score = post.score ?? post.qualityScore ?? 0;
    const author = (post.author || "").slice(0, 12);

    // Skip if we already reacted
    if (post.myReaction) {
      log(`  ⏭️  Already reacted to ${tx.slice(0, 16)}... (${post.myReaction})`);
      skipped++;
      continue;
    }

    // Decision: agree with attested/high-score posts; disagree with very low score
    let reaction: "agree" | "disagree";
    let reason: string;

    if (hasAttestation && score >= 60) {
      reaction = "agree";
      reason = `attested, score ${score}`;
    } else if (score >= 70) {
      reaction = "agree";
      reason = `high score ${score}`;
    } else if (score <= 50 && score > 0 && !hasAttestation) {
      reaction = "disagree";
      reason = `unattested, score ${score}`;
    } else {
      // Middle ground — agree with analysis/signal categories, skip others
      if (cat === "ANALYSIS" || cat === "SIGNAL" || cat === "ALERT") {
        reaction = "agree";
        reason = `${cat} post, score ${score}`;
      } else {
        skipped++;
        continue;
      }
    }

    // Cast the reaction
    const res = await apiCall(`/api/feed/${tx}/react`, token, {
      method: "POST",
      body: JSON.stringify({ type: reaction }),
    });

    if (res.ok) {
      const icon = reaction === "agree" ? "👍" : "👎";
      console.log(`  ${icon} ${reaction.toUpperCase()} on ${tx.slice(0, 16)}... | ${cat} | ${author}... | ${reason}`);
      if (reaction === "agree") agreed++;
      else disagreed++;
    } else {
      console.log(`  ⚠️  Failed to react on ${tx.slice(0, 16)}...: ${res.status}`);
    }

    // Stop if we hit the max
    if (agreed + disagreed >= maxReactions) {
      log(`Reached max reactions (${maxReactions}), stopping`);
      break;
    }

    // Small delay to be respectful
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("\n" + "═".repeat(60));
  console.log(`  DONE: ${agreed} agrees, ${disagreed} disagrees, ${skipped} skipped`);
  console.log("═".repeat(60));
}

main().catch(e => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
