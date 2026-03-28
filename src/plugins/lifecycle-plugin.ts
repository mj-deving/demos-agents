/**
 * Lifecycle plugin — source health testing and state transitions.
 *
 * Manages the source lifecycle state machine:
 *   quarantined -> active  (3 consecutive passes)
 *   active -> degraded     (3 fails or rating < 40)
 *   degraded -> active     (recovery: 3 passes + rating >= 60)
 *   quarantined -> archived (5 consecutive failures)
 *
 * beforeSense hook: samples sources, tests health, applies transitions.
 *
 * Delegates to: src/lib/sources/catalog.ts, src/lib/sources/health.ts,
 *               src/lib/sources/lifecycle.ts
 */

import type { FrameworkPlugin } from "../types.js";
import type { BeforeSenseContext } from "../lib/util/extensions.js";

/**
 * beforeSense hook — sample sources, test health, apply transitions.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function lifecycleBeforeSense(ctx: BeforeSenseContext): Promise<void> {
  ctx.logger?.info("Extension: lifecycle (source health + transitions)...");
  try {
    const { resolve } = await import("node:path");
    const { writeFileSync, renameSync } = await import("node:fs");
    const { loadCatalog } = await import("../lib/sources/catalog.js");
    const { testSource } = await import("../lib/sources/health.js");
    const { sampleSources, updateRating, evaluateTransition, applyTransitions } = await import("../lib/sources/lifecycle.js");
    const { observe } = await import("../lib/pipeline/observe.js");
    const catalogPath = resolve(import.meta.dirname || ".", "../../config/sources/catalog.json");
    const catalog = loadCatalog(catalogPath);
    if (!catalog) {
      ctx.logger?.info("Lifecycle: catalog not found — skipping");
      return;
    }

    const allSources = catalog.sources;
    const sampleSize = 10;
    const sampled = sampleSources(allSources, sampleSize);

    if (sampled.length === 0) {
      ctx.logger?.info("Lifecycle: no eligible sources to test");
      return;
    }

    ctx.logger?.info(`Lifecycle: testing ${sampled.length} sources...`);
    const transitions: Array<{ currentStatus: string; newStatus: string | null; reason: string }> = [];
    const updatedMap = new Map<string, (typeof allSources)[number]>();

    for (const source of sampled) {
      const testResult = await testSource(source);
      const withRating = updateRating(source, testResult);
      const transition = evaluateTransition(withRating, testResult);
      updatedMap.set(source.id, withRating);
      if (transition.newStatus !== null) {
        transitions.push(transition);
        observe("insight", `Lifecycle transition: ${source.id} ${transition.currentStatus}→${transition.newStatus}`, {
          phase: "sense", source: "lifecycle-plugin.ts:beforeSense",
          data: { sourceId: source.id, from: transition.currentStatus, to: transition.newStatus, reason: transition.reason },
        });
      }
    }

    // Persist: merge rating updates + transitions into full catalog
    if (!ctx.flags.dryRun) {
      const fullSources = allSources.map((s) => updatedMap.get(s.id) || s);
      const withTransitions = transitions.length > 0
        ? applyTransitions(fullSources, transitions)
        : fullSources;
      const tmpPath = catalogPath + ".tmp";
      writeFileSync(tmpPath, JSON.stringify({ ...catalog, generatedAt: new Date().toISOString(), sources: withTransitions }, null, 2) + "\n");
      renameSync(tmpPath, catalogPath);
    }

    ctx.logger?.result(`Lifecycle: ${sampled.length} tested, ${transitions.length} transition(s)${ctx.flags.dryRun ? " (dry-run)" : ""}`);
  } catch (e: unknown) {
    // Non-fatal: lifecycle errors must not block other beforeSense hooks
    const msg = e instanceof Error ? e.message : String(e);
    const { observe } = await import("../lib/pipeline/observe.js");
    observe("error", `Lifecycle hook failed: ${msg}`, {
      phase: "sense", source: "lifecycle-plugin.ts:beforeSense",
    });
    ctx.logger?.info(`Lifecycle: error (non-fatal) — ${msg}`);
  }
}

export function createLifecyclePlugin(): FrameworkPlugin {
  return {
    name: "lifecycle",
    version: "1.0.0",
    description: "Source lifecycle health testing and state transitions",
    hooks: {},
  };
}
