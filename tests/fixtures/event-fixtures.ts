/**
 * Shared test fixtures for event sources and handlers.
 */

import type { AgentEvent } from "../../core/types.js";

/**
 * Create a minimal AgentEvent for testing handlers.
 */
export function makeAgentEvent<T = unknown>(overrides: {
  type: string;
  sourceId: string;
  payload: T;
  id?: string;
  watermark?: unknown;
}): AgentEvent<T> {
  return {
    id: overrides.id ?? `${overrides.sourceId}:${Date.now()}:test`,
    sourceId: overrides.sourceId,
    type: overrides.type,
    detectedAt: Date.now(),
    payload: overrides.payload,
    watermark: overrides.watermark ?? {},
  };
}
