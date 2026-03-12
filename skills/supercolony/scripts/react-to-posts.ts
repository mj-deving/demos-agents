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

import { webcrypto } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
if (!globalThis.crypto) { (globalThis as any).crypto = webcrypto; }

import { Demos } from "@kynesyslabs/demosdk/websdk";

const RPC_URL = "https://demosnode.discus.sh/";
const SUPERCOLONY_API = "https://www.supercolony.ai";
const AUTH_CACHE_PATH = resolve(homedir(), ".supercolony-auth.json");

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

function loadMnemonic(envPath: string): string {
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/DEMOS_MNEMONIC="(.+?)"/);
  if (!match) throw new Error(`No DEMOS_MNEMONIC found in ${envPath}`);
  return match[1];
}

async function apiCall(path: string, token: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };
  try {
    const res = await fetch(`${SUPERCOLONY_API}${path}`, { ...options, headers });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: err.message };
  }
}

async function authenticate(demos: Demos, address: string): Promise<string> {
  if (existsSync(AUTH_CACHE_PATH)) {
    const cache = JSON.parse(readFileSync(AUTH_CACHE_PATH, "utf-8"));
    if (cache.expiresAt > Date.now()) {
      log("Using cached auth token");
      return cache.token;
    }
  }
  log("Authenticating fresh...");
  const challengeRes = await fetch(`${SUPERCOLONY_API}/api/auth/challenge?address=${address}`);
  const challengeData = await challengeRes.json() as any;
  const { challenge, message } = challengeData;
  const signature = await demos.signMessage(message);
  const verifyRes = await fetch(`${SUPERCOLONY_API}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, challenge, signature: signature.data, algorithm: signature.type }),
  });
  const verifyData = await verifyRes.json() as any;
  if (!verifyData.token) throw new Error(`Auth failed: ${JSON.stringify(verifyData)}`);
  writeFileSync(AUTH_CACHE_PATH, JSON.stringify({ token: verifyData.token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }));
  return verifyData.token;
}

const XDG_CREDENTIALS = resolve(homedir(), ".config/demos/credentials");

function resolveCredentialPath(explicitPath: string): string {
  if (explicitPath !== resolve(process.cwd(), ".env")) return explicitPath; // explicit --env flag
  if (existsSync(XDG_CREDENTIALS)) return XDG_CREDENTIALS;
  return explicitPath;
}

async function main() {
  const maxReactions = parseMaxFlag();
  const envPath = resolveCredentialPath(resolve(parseArg("--env", resolve(process.cwd(), ".env"))));
  const explicitAddress = parseArg("--address", "");

  console.log("\n" + "═".repeat(60));
  console.log(`  SENTINEL — React to other agents' posts (max: ${maxReactions})`);
  console.log("═".repeat(60));

  const demos = new Demos();
  await demos.connect(RPC_URL);
  const address = await demos.connectWallet(loadMnemonic(envPath));
  const ourAddress = explicitAddress || address;
  log(`Wallet: ${address.slice(0, 20)}...`);
  const token = await authenticate(demos, address);

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
