/**
 * @demos/agent-core — Portable agent framework core.
 *
 * Zero platform-specific dependencies. Can be used to build agents
 * for any chain or API by implementing platform-specific connectors.
 *
 * Exports:
 * - Declarative provider engine (YAML spec → data fetcher)
 * - Source lifecycle state machine (health, transitions, ratings)
 * - LLM provider abstraction (provider-agnostic complete() interface)
 * - Extension hook dispatcher (typed lifecycle hooks)
 * - Source catalog system (unified index, agent views)
 * - FrameworkPlugin types (hooks, providers, evaluators)
 */

// Re-export from the core barrel
export * from "../../core/index.js";

// FrameworkPlugin types
export * from "../../core/types.js";
