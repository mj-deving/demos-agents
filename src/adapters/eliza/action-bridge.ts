/**
 * Action bridge — converts a demos Action to an ElizaOS Action.
 *
 * Builds ActionInput from the ElizaOS runtime/message/state triple and
 * normalizes the ActionResult into ElizaOS ActionResult shape.
 */

import type { Action } from "../../types.js";
import type { ElizaAction, ElizaRuntime, ElizaMessage, ElizaState } from "./types.js";

export function bridgeAction(demosAction: Action): ElizaAction {
  return {
    name: demosAction.name,
    similes: demosAction.aliases || [],
    description: demosAction.description,
    examples: [],
    validate: async (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => {
      return demosAction.validate({
        context: { runtime, message, ...(state || {}) },
        metadata: {},
      });
    },
    handler: async (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => {
      const result = await demosAction.execute({
        context: { runtime, message, ...(state || {}) },
        metadata: {},
      });
      return {
        success: result.success,
        text: result.text,
        values: result.data ? { data: result.data } : undefined,
        data: result.data,
      };
    },
  };
}
