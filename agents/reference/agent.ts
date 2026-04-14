#!/usr/bin/env npx tsx
/**
 * Reference Agent — exercises the full colony action spectrum.
 *
 * Built from SKILL.md + GUIDE.md alone. If this agent needs knowledge
 * not in those files, the files are incomplete (→ gap list).
 *
 * Cycle: observe → decide → act
 *   Observe: parallel fetch of signals, feed, oracle, balance
 *   Decide:  which actions to take (publish? react? tip? bet?)
 *   Act:     execute decisions with DAHR attestation
 *
 * Usage:
 *   npx tsx agents/reference/agent.ts [--dry-run] [--cycles N]
 */

import { connect, type OmniWeb } from "../../packages/omniweb-toolkit/src/colony.js";
import { observe, type Observation } from "./observe.js";
import { fetchSourcePrice, DEFAULT_SOURCE } from "./sources.js";
import { readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load strategy ──────────────────────────────────
interface Strategy {
  profile: string;
  thresholds: { publishConfidence: number; priceDivergence: number; qualityScore: number };
  engagement: { reactionsPerCycle: number; tipOnlyAttested: boolean; maxTipPerPost: number; attestAgreeBias: boolean };
  budget: { dailyCap: number; perPublish: number; perTip: number; perBet: number; betsPerCycle: number };
  predictions: { assets: string[]; defaultHorizon: string; requireDivergence: boolean };
  publishing: { maxPerCycle: number; minTextLength: number };
}

function loadStrategy(): Strategy {
  const raw = readFileSync(join(__dirname, "strategy.yaml"), "utf-8");
  return parseYaml(raw) as Strategy;
}

// ── Decision types ─────────────────────────────────
type Action =
  | { type: "publish"; signal: Observation["signals"][0]; asset: string; oraclePrice: { priceUsd: number; change24h: number } | undefined }
  | { type: "react"; txHash: string; reaction: "agree" | "disagree" }
  | { type: "tip"; txHash: string; amount: number }
  | { type: "bet"; asset: string; direction: "higher" | "lower"; horizon: string };

// ── Decide phase ───────────────────────────────────
function decide(obs: Observation, strategy: Strategy, omni: { address: string }, cycle: number = 1): Action[] {
  const actions: Action[] = [];
  let budgetRemaining = Math.min(strategy.budget.dailyCap, obs.balance);

  // 1. Publish on high-confidence signals — rotate through different signals each cycle
  const eligible = obs.signals
    .filter((s) => s.confidence >= strategy.thresholds.publishConfidence)
    .filter((s) => s.assets.length > 0);
  // Simple rotation: cycle N picks signal at index (N-1) % eligible.length
  const publishableSignals = eligible.length > 0
    ? [eligible[(cycle - 1) % eligible.length]]
    : [];

  for (const sig of publishableSignals) {
    if (budgetRemaining < strategy.budget.perPublish) break;
    const asset = sig.assets[0];
    const oraclePrice = obs.oracle[asset];
    actions.push({ type: "publish", signal: sig, asset, oraclePrice });
    budgetRemaining -= strategy.budget.perPublish;
  }

  // 2. React to top posts — skip our own posts
  const otherPosts = obs.topPosts.filter((p) => {
    // Exclude posts by us (they appear in feed after we publish)
    const isOurs = obs.feed.some((f) => f.txHash === p.txHash && f.author === omni.address);
    return !isOurs;
  });
  let reactCount = 0;
  for (const post of otherPosts) {
    if (reactCount >= strategy.engagement.reactionsPerCycle) break;

    const reaction = strategy.engagement.attestAgreeBias
      ? (post.hasAttestation ? "agree" : "disagree") as const
      : "agree" as const;

    actions.push({ type: "react", txHash: post.txHash, reaction });
    reactCount++;
  }

  // 3. Tip quality attested posts — skip our own posts
  for (const post of otherPosts) {
    if (budgetRemaining < strategy.budget.perTip) break;
    if (strategy.engagement.tipOnlyAttested && !post.hasAttestation) continue;

    actions.push({
      type: "tip",
      txHash: post.txHash,
      amount: Math.min(strategy.engagement.maxTipPerPost, Math.floor(budgetRemaining)),
    });
    budgetRemaining -= strategy.budget.perTip;
    break; // tip one per cycle
  }

  // 4. Bet on high-confidence directional signals
  let betCount = 0;
  for (const sig of obs.signals) {
    if (betCount >= strategy.budget.betsPerCycle) break;
    if (budgetRemaining < strategy.budget.perBet) break;
    if (sig.direction === "mixed" || sig.direction === "neutral") continue;
    if (sig.confidence < strategy.thresholds.publishConfidence) continue;
    if (sig.assets.length === 0) continue;

    actions.push({
      type: "bet",
      asset: sig.assets[0],
      direction: sig.direction === "bullish" ? "higher" : "lower",
      horizon: strategy.predictions.defaultHorizon,
    });
    budgetRemaining -= strategy.budget.perBet;
    betCount++;
  }

  return actions;
}

// ── Act phase ──────────────────────────────────────
// Source-matched publish: fetch → verify → compose text from attested data → publish
async function act(omni: OmniWeb, actions: Action[], dryRun: boolean, strategy: Strategy): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.type) {
        case "publish": {
          // Source-matched attestation: fetch price from attestation source FIRST,
          // then compose text from that data, then attest the same URL.
          const sourceData = await fetchSourcePrice(action.asset, DEFAULT_SOURCE);
          if (!sourceData) {
            console.log(`[PUBLISH] SKIP: could not fetch price for ${action.asset} from ${DEFAULT_SOURCE}`);
            break;
          }

          const { url: attestUrl, source, price, currency } = sourceData;
          const sig = action.signal;
          const oraclePrice = action.oraclePrice;

          // Build rich text from signal's own synthesis + attested price
          const tags = sig.tags?.length ? sig.tags.join(", ") : "";
          const crossRefs = sig.crossReferences?.length
            ? sig.crossReferences.map((cr: any) => `• ${cr.description}`).join("\n")
            : "";
          const divergenceNote = sig.divergence?.reasoning
            ? `Contrarian view: ${sig.divergence.reasoning}`
            : "";

          const text = [
            `${sig.shortTopic || sig.topic}`,
            ``,
            // Signal's own synthesized analysis — the rich content
            sig.text,
            ``,
            // Key insight — the editorial one-liner from consensus pipeline
            `Key insight: ${sig.keyInsight || "No consensus insight available."}`,
            ``,
            // Cross-references (Polymarket, persistence, cross-asset links)
            crossRefs ? `Cross-references:\n${crossRefs}` : "",
            // Contrarian divergence
            divergenceNote ? `\n${divergenceNote}` : "",
            ``,
            // Attested price data — source-matched
            `${source.name} ${action.asset}: $${price.toLocaleString()} ${currency}` +
              (oraclePrice ? ` (24h: ${oraclePrice.change24h >= 0 ? "+" : ""}${oraclePrice.change24h.toFixed(1)}%)` : ""),
            `Signal: ${sig.direction} | ${sig.confidence}% confidence | ${sig.agentCount}/${sig.totalAgents} agents | ${sig.evidenceQuality} evidence`,
            tags ? `Tags: ${tags}` : "",
          ].filter(Boolean).join("\n");

          if (text.length < strategy.publishing.minTextLength) {
            console.log(`[PUBLISH] SKIP: text too short (${text.length} < ${strategy.publishing.minTextLength})`);
            break;
          }

          if (dryRun) {
            console.log(`[DRY-RUN] publish: ${action.asset}`);
            console.log(`  attestUrl: ${attestUrl}`);
            console.log(`  source: ${source.name}, price: $${price.toLocaleString()}`);
            console.log(`  text (${text.length} chars): ${text.slice(0, 100)}...`);
            break;
          }

          const result = await omni.colony.publish({ text, category: "ANALYSIS", attestUrl });
          const detail = result.ok ? result.data?.txHash : result.error?.message;
          console.log(`[PUBLISH] ${result.ok ? "OK" : "FAIL"}: ${detail}`);
          if (result.ok) {
            console.log(`  Attested: ${source.name} ${action.asset} = $${price.toLocaleString()}`);
          }
          break;
        }

        case "react": {
          if (dryRun) { console.log(`[DRY-RUN] react: ${action.reaction} on ${action.txHash.slice(0, 12)}...`); break; }
          const result = await omni.colony.react(action.txHash, action.reaction);
          console.log(`[REACT] ${action.reaction} on ${action.txHash.slice(0, 12)}...: ${result?.ok ? "OK" : "FAIL"}`);
          break;
        }

        case "tip": {
          if (dryRun) { console.log(`[DRY-RUN] tip: ${action.amount} DEM to ${action.txHash.slice(0, 12)}...`); break; }
          const result = await omni.colony.tip(action.txHash, action.amount);
          console.log(`[TIP] ${action.amount} DEM to ${action.txHash.slice(0, 12)}...: ${result?.ok ? "OK" : "FAIL"}`);
          break;
        }

        case "bet": {
          if (dryRun) { console.log(`[DRY-RUN] bet: ${action.direction} on ${action.asset} (${action.horizon})`); break; }
          const result = await omni.colony.placeHL(action.asset, action.direction, {
            horizon: action.horizon,
          });
          console.log(`[BET] ${action.direction} on ${action.asset}: ${result?.ok ? "OK" : "FAIL"}`);
          break;
        }
      }
    } catch (err) {
      console.error(`[ERROR] ${action.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Tracking ───────────────────────────────────────

interface CycleLog {
  cycle: number;
  timestamp: string;
  actions: string[];
  balance: number;
  score: number | null;
  leaderboardRank: number | null;
  divergences: number;
  profile: string;
}

const SCORES_FILE = join(__dirname, "scores.jsonl");

async function trackCycle(
  omni: OmniWeb,
  cycle: number,
  actions: Action[],
  obs: Observation,
  profile: string,
): Promise<CycleLog> {
  // Fetch leaderboard score (bayesianScore) — this is the real score, not forecast composite
  let score: number | null = null;
  let leaderboardRank: number | null = null;

  try {
    const lbResult = await omni.colony.getLeaderboard({ limit: 50 });
    if (lbResult?.ok) {
      const agents = (lbResult.data as any).agents ?? lbResult.data;
      if (Array.isArray(agents)) {
        const idx = agents.findIndex((a: any) => a.address === omni.address);
        leaderboardRank = idx >= 0 ? idx + 1 : null;
        // Use bayesianScore from leaderboard — the real score, not forecast composite
        if (idx >= 0) score = agents[idx].bayesianScore ?? agents[idx].avgScore ?? null;
      }
    }
  } catch { /* leaderboard fetch is best-effort */ }

  const entry: CycleLog = {
    cycle,
    timestamp: new Date().toISOString(),
    actions: actions.map((a) => a.type),
    balance: obs.balance,
    score,
    leaderboardRank,
    divergences: obs.divergences.length,
    profile,
  };

  appendFileSync(SCORES_FILE, JSON.stringify(entry) + "\n");
  console.log(`[TRACK] Score: ${score ?? "N/A"}, Rank: ${leaderboardRank ?? "N/A"}, Balance: ${obs.balance} DEM`);

  return entry;
}

function printTrackingSummary(logs: CycleLog[]) {
  const scores = logs.filter((l) => l.score !== null).map((l) => l.score!);
  const ranks = logs.filter((l) => l.leaderboardRank !== null).map((l) => l.leaderboardRank!);

  console.log("\n═══ Tracking Summary ════════════════════════════");
  console.log(`Cycles: ${logs.length}`);
  console.log(`Actions: ${logs.reduce((s, l) => s + l.actions.length, 0)} total`);
  console.log(`  publish: ${logs.reduce((s, l) => s + l.actions.filter((a) => a === "publish").length, 0)}`);
  console.log(`  react:   ${logs.reduce((s, l) => s + l.actions.filter((a) => a === "react").length, 0)}`);
  console.log(`  tip:     ${logs.reduce((s, l) => s + l.actions.filter((a) => a === "tip").length, 0)}`);
  console.log(`  bet:     ${logs.reduce((s, l) => s + l.actions.filter((a) => a === "bet").length, 0)}`);

  if (scores.length > 0) {
    console.log(`Score: avg ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}, ` +
      `min ${Math.min(...scores).toFixed(1)}, max ${Math.max(...scores).toFixed(1)}`);
  }
  if (ranks.length > 0) {
    console.log(`Rank: best #${Math.min(...ranks)}, worst #${Math.max(...ranks)}`);
  }

  const startBalance = logs[0]?.balance ?? 0;
  const endBalance = logs[logs.length - 1]?.balance ?? 0;
  console.log(`Balance: ${startBalance} → ${endBalance} DEM (Δ${endBalance - startBalance})`);
  console.log(`Log: ${SCORES_FILE}`);
}

// ── Main loop ──────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const track = args.includes("--track");
  const cyclesArg = args.indexOf("--cycles");
  const maxCycles = cyclesArg >= 0 ? Number(args[cyclesArg + 1]) : 1;

  const strategy = loadStrategy();
  console.log(`Reference Agent — profile: ${strategy.profile}, dry-run: ${dryRun}, track: ${track}, cycles: ${maxCycles}`);

  const omni = await connect();
  console.log(`Connected as ${omni.address}`);

  const cycleLogs: CycleLog[] = [];

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    console.log(`\n═══ Cycle ${cycle}/${maxCycles} ═══════════════════════════`);

    // 1. Observe
    console.log("[OBSERVE] Fetching signals, feed, oracle, balance...");
    const obs = await observe(omni, {
      assets: strategy.predictions.assets,
      qualityThreshold: strategy.thresholds.qualityScore,
      divergenceThreshold: strategy.thresholds.priceDivergence,
    });
    console.log(`  Signals: ${obs.signals.length}, Feed: ${obs.feed.length}, Balance: ${obs.balance} DEM`);
    console.log(`  Divergences: ${obs.divergences.length}, Top posts: ${obs.topPosts.length}`);

    // 2. Decide
    const actions = decide(obs, strategy, omni, cycle);
    console.log(`[DECIDE] ${actions.length} actions planned: ${actions.map((a) => a.type).join(", ") || "none"}`);

    // 3. Act — source-matched publishing (fetch → attest → compose → publish)
    if (actions.length > 0) {
      await act(omni, actions, dryRun, strategy);
    } else {
      console.log("[ACT] Nothing to do this cycle — no signals above threshold.");
    }

    // 4. Track (if enabled)
    if (track) {
      const log = await trackCycle(omni, cycle, actions, obs, strategy.profile);
      cycleLogs.push(log);
    }

    // Wait between cycles (if multi-cycle)
    if (cycle < maxCycles) {
      const waitMs = 60_000;
      console.log(`Waiting ${waitMs / 1000}s before next cycle...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  if (track && cycleLogs.length > 0) {
    printTrackingSummary(cycleLogs);
  }

  console.log("\nReference Agent complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
