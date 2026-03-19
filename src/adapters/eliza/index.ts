/**
 * ElizaOS adapter — barrel export for all bridges.
 */

export { personaToCharacter } from "./config-bridge.js";
export { bridgeAction } from "./action-bridge.js";
export { bridgeProvider } from "./provider-bridge.js";
export { bridgeEvaluator } from "./evaluator-bridge.js";
export { EventSourceService } from "./event-service.js";
export { createElizaWatermarkStore } from "./watermark-adapter.js";
export { createElizaPlugin } from "./plugin.js";
export type * from "./types.js";
