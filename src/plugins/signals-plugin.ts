/**
 * Signals plugin — consensus signal fetching and alignment scoring.
 *
 * When 2+ agents publish on the same topic with confidence >= 40%,
 * the consensus pipeline triggers clustering, signal extraction,
 * and alignment reports. This plugin wraps that capability.
 *
 * beforeSense hook: fetches consensus signals + colony briefing,
 * injects snapshots into V2 session state.
 *
 * Delegates to: src/lib/signals.ts, src/lib/auth.ts
 */

import type { FrameworkPlugin } from "../types.js";
import type { BeforeSenseContext } from "../lib/extensions.js";

/**
 * beforeSense hook — fetch consensus signals + briefing before SENSE.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function signalsBeforeSense(ctx: BeforeSenseContext): Promise<void> {
  ctx.logger?.info("Extension: signals (fetching consensus + briefing)...");
  try {
    const { loadAuthCache } = await import("../lib/auth.js");
    const cached = loadAuthCache();
    if (!cached) {
      ctx.logger?.info("Signals: no auth token cached — skipping");
      return;
    }
    const { fetchSignals, fetchLatestBriefing } = await import("../lib/signals.js");
    const [signalResult, briefingResult] = await Promise.allSettled([
      fetchSignals(cached.token),
      fetchLatestBriefing(cached.token),
    ]);
    if (signalResult.status === "fulfilled" && signalResult.value && ctx.state.loopVersion === 2) {
      (ctx.state as any).signalSnapshot = signalResult.value;
      ctx.logger?.result(`Signals: ${signalResult.value.topics.length} topic(s), ${signalResult.value.alerts.length} alert(s)`);
    }
    if (briefingResult.status === "fulfilled" && briefingResult.value && ctx.state.loopVersion === 2) {
      (ctx.state as any).briefingContext = briefingResult.value;
      ctx.logger?.info(`Briefing: ${briefingResult.value.length} chars`);
    }
  } catch (e: any) {
    const { observe } = await import("../lib/observe.js");
    observe("error", `Signals/briefing fetch failed: ${e.message}`, {
      phase: "sense", source: "signals-plugin.ts:beforeSense",
    });
  }
}

export function createSignalsPlugin(): FrameworkPlugin {
  return {
    name: "signals",
    version: "1.0.0",
    description: "Consensus signal fetching and alignment scoring",
    hooks: {},
  };
}
