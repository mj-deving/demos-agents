/**
 * Agent loop re-exports for supercolony-toolkit/agent subpath.
 *
 * Provides the runAgentLoop, defaultObserve, and buildColonyStateFromFeed
 * functions for consumers who want to run a full agent loop.
 */

export { runAgentLoop, defaultObserve, buildColonyStateFromFeed } from "../../../src/toolkit/agent-loop.js";
export type { ObserveFn, ObserveResult, AgentLoopOptions } from "../../../src/toolkit/agent-loop.js";
