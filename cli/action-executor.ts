import type { StrategyAction } from "../src/toolkit/strategy/types.js";
import { reactToPost } from "../src/toolkit/tools/react.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import { recordInteraction } from "../src/toolkit/colony/intelligence.js";

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
  /** Colony DB for recording interactions (optional — graceful if absent) */
  colonyDb?: ColonyDatabase;
  /** Our wallet address for interaction tracking */
  ourAddress?: string;
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
          if (deps.colonyDb && deps.ourAddress) {
            try {
              recordInteraction(deps.colonyDb, {
                ourTxHash: deps.ourAddress,
                theirTxHash: action.target!,
                theirAddress: (action.metadata?.author as string) ?? action.target!,
                interactionType: "agreed",
                timestamp: new Date().toISOString(),
              });
            } catch { /* interaction tracking is best-effort */ }
          }
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
          if (deps.colonyDb && deps.ourAddress && action.target) {
            try {
              recordInteraction(deps.colonyDb, {
                ourTxHash: publishResult.txHash,
                theirTxHash: action.target,
                theirAddress: (action.metadata?.author as string) ?? "unknown",
                interactionType: "we_replied",
                timestamp: new Date().toISOString(),
              });
            } catch { /* interaction tracking is best-effort */ }
          }
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
          const postTxHash = (action.metadata?.postTxHash as string) ?? action.target!;

          // 2-step tipping: API validates spam limits → SDK transfer with HIVE_TIP memo
          let recipient = action.target!;
          try {
            const tipValidation = await deps.bridge.apiCall("/api/tip", {
              method: "POST",
              body: JSON.stringify({ postTxHash, amount }),
              headers: { "Content-Type": "application/json" },
            });
            if (tipValidation.ok && tipValidation.data && typeof tipValidation.data === "object") {
              const tipData = tipValidation.data as { ok?: boolean; recipient?: string; error?: string };
              if (tipData.ok === false) {
                result.skipped.push({ action, reason: `Tip validation failed: ${tipData.error ?? "unknown"}` });
                deps.observe("insight", `TIP rejected by API: ${tipData.error}`, {
                  actionType: action.type, target: action.target, postTxHash,
                });
                continue;
              }
              if (tipData.recipient) recipient = tipData.recipient;
            }
          } catch {
            // API validation failed — fall back to direct transfer (best effort)
            deps.observe("warning", "Tip API validation unavailable, using direct transfer", {
              source: "action-executor:tip", target: action.target,
            });
          }

          const transferResult = await deps.bridge.transferDem(recipient, amount);
          result.executed.push({ action, success: true, txHash: transferResult.txHash });
          deps.observe("insight", `Strategy TIP executed for ${recipient}`, {
            actionType: action.type,
            target: recipient,
            amount,
            txHash: transferResult.txHash,
          });
          if (deps.colonyDb && deps.ourAddress) {
            try {
              recordInteraction(deps.colonyDb, {
                ourTxHash: transferResult.txHash,
                theirTxHash: postTxHash,
                theirAddress: recipient,
                interactionType: "we_tipped",
                timestamp: new Date().toISOString(),
              });
            } catch { /* interaction tracking is best-effort */ }
          }
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
