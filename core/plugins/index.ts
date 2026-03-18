/**
 * Plugin barrel export — all 9 FrameworkPlugin factory functions.
 *
 * Each plugin wraps an existing extension or capability from the
 * tools/lib layer, exposing it through the FrameworkPlugin interface
 * for registry-based discovery and lifecycle management.
 */

export { createSourcesPlugin } from "./sources-plugin.js";
export { createLifecyclePlugin } from "./lifecycle-plugin.js";
export { createSignalsPlugin } from "./signals-plugin.js";
export { createPredictionsPlugin } from "./predictions-plugin.js";
export { createTipsPlugin } from "./tips-plugin.js";
export { createCalibratePlugin } from "./calibrate-plugin.js";
export { createObservePlugin } from "./observe-plugin.js";
export { createDefiMarketsPlugin } from "./defi-markets-plugin.js";
export { createInfraOpsPlugin } from "./infra-ops-plugin.js";
