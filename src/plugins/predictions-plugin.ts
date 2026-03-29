/**
 * Predictions plugin — prediction registration, resolution, and calibration.
 *
 * Tracks predicted outcomes (e.g., expected reaction counts) and compares
 * them against actual results. Feeds calibration offset into future
 * confidence scoring.
 *
 * beforeSense hook: resolves pending predictions using feed data.
 * afterConfirm hook: registers new PREDICTION-category posts.
 *
 * State file: ~/.{agent}/predictions.json
 * Delegates to: src/lib/predictions.ts, src/lib/auth.ts
 */

import type { FrameworkPlugin } from "../types.js";
import type { BeforeSenseContext, AfterConfirmContext } from "../lib/util/extensions.js";

/**
 * beforeSense hook — resolve pending predictions before SENSE.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function predictionsBeforeSense(ctx: BeforeSenseContext): Promise<void> {
  ctx.logger?.info("Extension: predictions (checking pending resolutions)...");
  try {
    const { loadAuthCache } = await import("../lib/auth/auth.js");
    const cached = loadAuthCache();
    const token = cached?.token || "";
    const { loadPredictions, savePredictions, resolvePendingPredictions, getCalibrationAdjustment } = await import("../lib/predictions.js");
    let store = loadPredictions(ctx.config.name);
    store = await resolvePendingPredictions(store, token);
    savePredictions(store);
    const pending = Object.values(store.predictions).filter(p => p.status === "pending").length;
    const resolved = Object.values(store.predictions).filter(p => p.status === "correct" || p.status === "incorrect").length;
    const adj = getCalibrationAdjustment(store);
    ctx.logger?.result(`Predictions: ${pending} pending, ${resolved} resolved, calibration adj: ${adj > 0 ? "+" : ""}${adj}`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const { observe } = await import("../lib/pipeline/observe.js");
    observe("error", `Predictions resolution failed: ${message}`, {
      phase: "sense", source: "predictions-plugin.ts:beforeSense",
    });
  }
}

/**
 * afterConfirm hook — register new PREDICTION-category posts.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function predictionsAfterConfirm(ctx: AfterConfirmContext): Promise<void> {
  if (!ctx.publishedPosts || ctx.publishedPosts.length === 0) return;
  const predictionPosts = ctx.publishedPosts.filter(p => p.category.toUpperCase() === "PREDICTION");
  if (predictionPosts.length === 0) return;

  ctx.logger?.info(`Extension: predictions (registering ${predictionPosts.length} prediction(s))...`);
  const { loadPredictions, savePredictions, registerPrediction } = await import("../lib/predictions.js");
  let store = loadPredictions(ctx.config.name);
  for (const post of predictionPosts) {
    store = registerPrediction(store, post);
  }
  savePredictions(store);
  ctx.logger?.result(`Predictions registered: ${predictionPosts.length}`);
}

export function createPredictionsPlugin(): FrameworkPlugin {
  return {
    name: "predictions",
    version: "1.0.0",
    description: "Prediction registration, resolution, and calibration",
    hooks: {},
  };
}
