/**
 * Evaluator bridge — converts a demos Evaluator to an ElizaOS Evaluator.
 *
 * Maps the evaluate() call to the ElizaOS handler signature, logging
 * failures via runtime.log().
 */

import type { Evaluator } from "../../types.js";
import type { ElizaEvaluator, ElizaRuntime, ElizaMessage, ElizaState } from "./types.js";

export function bridgeEvaluator(demosEval: Evaluator): ElizaEvaluator {
  return {
    name: demosEval.name,
    description: demosEval.description,
    similes: [],
    examples: [],
    alwaysRun: false,
    validate: async () => true,
    handler: async (runtime: ElizaRuntime, message: ElizaMessage, _state?: ElizaState) => {
      const result = await demosEval.evaluate({
        text: message.content?.text || "",
        context: { runtime, message },
      });
      if (!result.pass) {
        runtime.log?.(`Evaluator ${demosEval.name} failed: ${result.reason}`);
      }
    },
  };
}
