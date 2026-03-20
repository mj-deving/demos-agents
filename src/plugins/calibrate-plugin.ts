/**
 * Calibrate plugin — score prediction calibration and offset adjustment.
 *
 * Compares predicted scores/reactions against actual outcomes and adjusts
 * a calibration offset stored in ~/.{agent}-improvements.json. The offset
 * is applied to future confidence scoring to improve prediction accuracy.
 *
 * beforeSense hook: runs audit tool via injected runTool function.
 * This is the one plugin that needs runtime dependency injection —
 * runTool depends on session-runner's execution backend (spawn/tmux).
 *
 * Delegates to: cli/audit.ts (via subprocess)
 */

import type { FrameworkPlugin } from "../types.js";
import type { BeforeSenseContext } from "../lib/extensions.js";

/** Function signature for running a CLI tool as subprocess. */
export type RunToolFn = (toolPath: string, args: string[], label: string) => Promise<any>;

/**
 * Create a beforeSense hook for calibrate with injected runTool dependency.
 *
 * This factory pattern is used because calibrate needs runToolAndParse from
 * session-runner, which can't be imported at module load time without
 * circular dependencies. Session-runner calls this during init and
 * registers the result via registerHook().
 */
export function createCalibrateBeforeSense(runTool: RunToolFn) {
  return async (ctx: BeforeSenseContext): Promise<void> => {
    ctx.logger?.info("Extension: calibrate (running audit)...");
    const auditArgs = ["--agent", ctx.flags.agent, "--update", "--log", ctx.flags.log, "--env", ctx.flags.env];
    const auditResult = await runTool("cli/audit.ts", auditArgs, "audit.ts (calibrate)");
    const stats = auditResult.stats || {};
    ctx.logger?.result(
      `Calibrate: ${stats.total_entries || 0} entries | avg error: ${stats.avg_prediction_error !== undefined ? stats.avg_prediction_error.toFixed(1) : "N/A"}`
    );
  };
}

export function createCalibratePlugin(): FrameworkPlugin {
  return {
    name: "calibrate",
    version: "1.0.0",
    description: "Score prediction calibration and offset adjustment",
    hooks: {},
  };
}
