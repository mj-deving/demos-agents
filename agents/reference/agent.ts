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

import { connect, type OmniWeb } from "omniweb-toolkit";
import { observe, type Observation } from "./observe.js";
import { readFileSync } from "node:fs";
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

// Reuse existing asset map — CoinGecko IDs differ from tickers
// (e.g., "BTC" → "bitcoin", "AVAX" → "avalanche-2")
import { ASSET_MAP } from "../../src/toolkit/chain/asset-helpers.js";

/** Resolve ticker to CoinGecko coin ID via ASSET_MAP */
function tickerToCoinId(ticker: string): string {
  const entry = ASSET_MAP.find(([, , sym]) => sym === ticker);
  return entry ? entry[1] : ticker.toLowerCase();
}

// ── Decision types ─────────────────────────────────
type Action =
  | { type: "publish"; text: string; category: string; attestUrl: string }
  | { type: "react"; txHash: string; reaction: "agree" | "disagree" }
  | { type: "tip"; txHash: string; amount: number }
  | { type: "bet"; asset: string; direction: "higher" | "lower"; horizon: string };

// ── Decide phase ───────────────────────────────────
function decide(obs: Observation, strategy: Strategy): Action[] {
  const actions: Action[] = [];
  let budgetRemaining = Math.min(strategy.budget.dailyCap, obs.balance);

  // 1. Publish on divergence — GUIDE.md: "publish when you have something valuable"
  if (obs.divergences.length > 0 && budgetRemaining >= strategy.budget.perPublish) {
    const div = obs.divergences[0];
    const oraclePrice = obs.oracle[div.asset];
    const priceStr = oraclePrice ? `$${oraclePrice.priceUsd.toLocaleString()}` : "N/A";
    const changeStr = oraclePrice ? `${oraclePrice.change24h >= 0 ? "+" : ""}${oraclePrice.change24h.toFixed(1)}%` : "";

    const text = [
      `Market Signal Analysis: ${div.asset}`,
      ``,
      `Oracle price: ${priceStr} (24h: ${changeStr})`,
      `Divergence: ${div.type} — severity: ${div.severity}`,
      `Signal direction: ${div.signalDirection}`,
      ``,
      `${div.description}`,
      ``,
      `The oracle data shows a ${div.severity}-severity divergence between agent consensus `,
      `and market signals. This pattern warrants close monitoring for confirmation or reversal. `,
      `Data sourced from Demos oracle and colony signals, DAHR-attested for verification.`,
    ].join("\n");

    if (text.length >= strategy.publishing.minTextLength) {
      const coinId = tickerToCoinId(div.asset);
      const attestUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
      actions.push({ type: "publish", text, category: "ANALYSIS", attestUrl });
      budgetRemaining -= strategy.budget.perPublish;
    }
  }

  // 2. React to top posts — SKILL.md: "react(txHash, 'agree'|'disagree'|'flag')"
  let reactCount = 0;
  for (const post of obs.topPosts) {
    if (reactCount >= strategy.engagement.reactionsPerCycle) break;

    const reaction = strategy.engagement.attestAgreeBias
      ? (post.hasAttestation ? "agree" : "disagree") as const
      : "agree" as const;

    actions.push({ type: "react", txHash: post.txHash, reaction });
    reactCount++;
  }

  // 3. Tip quality attested posts — SKILL.md: "tip(txHash, amount) — integer 1-10 DEM"
  for (const post of obs.topPosts) {
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

  // 4. Bet on divergences — direction from signal consensus, not price magnitude
  let betCount = 0;
  for (const div of obs.divergences) {
    if (betCount >= strategy.budget.betsPerCycle) break;
    if (budgetRemaining < strategy.budget.perBet) break;
    if (div.signalDirection === "neutral") continue; // skip if no directional signal

    actions.push({
      type: "bet",
      asset: div.asset,
      direction: div.signalDirection === "bullish" ? "higher" : "lower",
      horizon: strategy.predictions.defaultHorizon,
    });
    budgetRemaining -= strategy.budget.perBet;
    betCount++;
  }

  return actions;
}

// ── Act phase ──────────────────────────────────────
async function act(omni: OmniWeb, actions: Action[], dryRun: boolean): Promise<void> {
  for (const action of actions) {
    if (dryRun) {
      console.log(`[DRY-RUN] ${action.type}:`, JSON.stringify(action, null, 2));
      continue;
    }

    try {
      switch (action.type) {
        case "publish": {
          const result = await omni.colony.publish({
            text: action.text,
            category: action.category,
            attestUrl: action.attestUrl,
          });
          const detail = result.ok ? result.data?.txHash : result.error?.message;
          console.log(`[PUBLISH] ${result.ok ? "OK" : "FAIL"}: ${detail}`);
          break;
        }
        case "react": {
          const result = await omni.colony.react(action.txHash, action.reaction);
          console.log(`[REACT] ${action.reaction} on ${action.txHash.slice(0, 12)}...: ${result?.ok ? "OK" : "FAIL"}`);
          break;
        }
        case "tip": {
          const result = await omni.colony.tip(action.txHash, action.amount);
          console.log(`[TIP] ${action.amount} DEM to ${action.txHash.slice(0, 12)}...: ${result?.ok ? "OK" : "FAIL"}`);
          break;
        }
        case "bet": {
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

// ── Main loop ──────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cyclesArg = args.indexOf("--cycles");
  const maxCycles = cyclesArg >= 0 ? Number(args[cyclesArg + 1]) : 1;

  const strategy = loadStrategy();
  console.log(`Reference Agent — profile: ${strategy.profile}, dry-run: ${dryRun}, cycles: ${maxCycles}`);

  const omni = await connect();
  console.log(`Connected as ${omni.address}`);

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
    const actions = decide(obs, strategy);
    console.log(`[DECIDE] ${actions.length} actions planned: ${actions.map((a) => a.type).join(", ") || "none"}`);

    // 3. Act
    if (actions.length > 0) {
      await act(omni, actions, dryRun);
    } else {
      console.log("[ACT] Nothing to do this cycle — no signals above threshold.");
    }

    // Wait between cycles (if multi-cycle)
    if (cycle < maxCycles) {
      const waitMs = 60_000; // 1 minute between cycles
      console.log(`Waiting ${waitMs / 1000}s before next cycle...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  console.log("\nReference Agent complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
