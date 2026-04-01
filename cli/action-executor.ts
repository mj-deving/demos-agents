import type { StrategyAction } from "../src/toolkit/strategy/types.js";
import { reactToPost } from "../src/toolkit/tools/react.js";

export interface ActionExecutionResult {
  executed: Array<{
    action: StrategyAction;
    success: boolean;
    txHash?: string;
    error?: string;
  }>;
  skipped: Array<{
    action: StrategyAction;
    reason: string;
  }>;
}

export interface ActionExecutorDeps {
  /** SDK bridge for chain + API operations */
  bridge: {
    apiCall(path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }>;
    publishHivePost(post: { text: string; category: string; replyTo?: string }): Promise<{ txHash: string }>;
    transferDem(to: string, amount: number): Promise<{ txHash: string }>;
  };
  /** LLM provider for generating post text from evidence */
  generateText?: (action: StrategyAction) => Promise<string>;
  /** Dry run mode — log but don't execute */
  dryRun: boolean;
  /** Observer for logging */
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
}

function clampTipAmount(amount: unknown): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return 1;
  return Math.min(10, Math.max(1, amount));
}

export async function executeStrategyActions(
  actions: StrategyAction[],
  deps: ActionExecutorDeps,
): Promise<ActionExecutionResult> {
  const result: ActionExecutionResult = {
    executed: [],
    skipped: [],
  };

  for (const action of actions) {
    if (deps.dryRun) {
      deps.observe("insight", `Strategy action dry-run: ${action.type}`, {
        actionType: action.type,
        target: action.target,
        reason: action.reason,
      });
      result.executed.push({ action, success: true });
      continue;
    }

    if ((action.type === "ENGAGE" || action.type === "TIP") && !action.target) {
      result.skipped.push({ action, reason: "missing target" });
      deps.observe("insight", `Strategy action skipped: ${action.type} missing target`, {
        actionType: action.type,
        reason: action.reason,
      });
      continue;
    }

    if ((action.type === "REPLY" || action.type === "PUBLISH") && !deps.generateText) {
      result.skipped.push({ action, reason: "no text generator" });
      deps.observe("insight", `Strategy action skipped: ${action.type} has no text generator`, {
        actionType: action.type,
        target: action.target,
        reason: action.reason,
      });
      continue;
    }

    try {
      switch (action.type) {
        case "ENGAGE": {
          await reactToPost(deps.bridge, action.target!, "agree");
          result.executed.push({ action, success: true });
          deps.observe("insight", `Strategy ENGAGE executed for ${action.target}`, {
            actionType: action.type,
            target: action.target,
          });
          break;
        }

        case "REPLY": {
          const text = await deps.generateText!(action);
          const publishResult = await deps.bridge.publishHivePost({
            text,
            category: "discussion",
            replyTo: action.target,
          });
          result.executed.push({ action, success: true, txHash: publishResult.txHash });
          deps.observe("insight", `Strategy REPLY executed for ${action.target ?? "new thread"}`, {
            actionType: action.type,
            target: action.target,
            txHash: publishResult.txHash,
          });
          break;
        }

        case "PUBLISH": {
          const text = await deps.generateText!(action);
          const publishResult = await deps.bridge.publishHivePost({
            text,
            category: "analysis",
          });
          result.executed.push({ action, success: true, txHash: publishResult.txHash });
          deps.observe("insight", "Strategy PUBLISH executed", {
            actionType: action.type,
            txHash: publishResult.txHash,
          });
          break;
        }

        case "TIP": {
          const amount = clampTipAmount(action.metadata?.amount);
          const transferResult = await deps.bridge.transferDem(action.target!, amount);
          result.executed.push({ action, success: true, txHash: transferResult.txHash });
          deps.observe("insight", `Strategy TIP executed for ${action.target}`, {
            actionType: action.type,
            target: action.target,
            amount,
            txHash: transferResult.txHash,
          });
          break;
        }

        default: {
          result.skipped.push({ action, reason: "unknown action type" });
          deps.observe("insight", `Strategy action skipped: unknown type ${String((action as { type: unknown }).type)}`, {
            actionType: (action as { type: unknown }).type,
            target: action.target,
            reason: action.reason,
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.executed.push({ action, success: false, error: message });
      deps.observe("error", `Strategy action failed: ${action.type}`, {
        actionType: action.type,
        target: action.target,
        error: message,
      });
    }
  }

  return result;
}
