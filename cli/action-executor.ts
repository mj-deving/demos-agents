import type { StrategyAction } from "../src/toolkit/strategy/types.js";
import { reactToPost } from "../src/toolkit/tools/react.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import { recordInteraction } from "../src/toolkit/colony/intelligence.js";
import { getPostVerificationGate } from "../src/toolkit/colony/attestation-status.js";

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

/**
 * Resolve an agent address to their most recent post txHash (last 48h).
 * Used when strategy targets an agent (targetType: "agent") but executor needs a post txHash.
 * Optional topicHint narrows to posts matching the topic that triggered the action.
 */
export function resolveAgentToRecentPost(
  colonyDb: ColonyDatabase | undefined,
  agentAddress: string,
  topicHint?: string,
): string | null {
  if (!colonyDb) return null;
  try {
    // Compute threshold in JS to avoid ISO vs SQLite datetime format mismatch
    const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    if (topicHint) {
      // Escape LIKE wildcards to prevent injection
      const escapedHint = topicHint.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      // Prefer a post matching the topic that triggered the action
      const topicStmt = colonyDb.prepare(
        `SELECT tx_hash FROM posts
         WHERE author = ? AND timestamp > ? AND text LIKE ? ESCAPE '\\'
         ORDER BY timestamp DESC LIMIT 1`,
      );
      const topicRow = topicStmt.get(agentAddress, threshold, `%${escapedHint}%`) as { tx_hash: string } | undefined;
      if (topicRow?.tx_hash) return topicRow.tx_hash;
    }

    // Fallback: most recent post by this agent
    const stmt = colonyDb.prepare(
      `SELECT tx_hash FROM posts
       WHERE author = ? AND timestamp > ?
       ORDER BY timestamp DESC LIMIT 1`,
    );
    const row = stmt.get(agentAddress, threshold) as { tx_hash: string } | undefined;
    return row?.tx_hash ?? null;
  } catch {
    return null;
  }
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

/** Infer post category from strategy action metadata and rule name. Explicit metadata wins. */
function inferCategory(action: StrategyAction): string {
  if (typeof action.metadata?.category === "string") return action.metadata.category;

  const reason = action.reason.toLowerCase();
  if (reason.includes("prediction") || reason.includes("ballot")) return "prediction";
  if (reason.includes("divergence") || reason.includes("signal")) return "signal";
  if (reason.includes("alert") || reason.includes("urgent")) return "alert";
  if (reason.includes("observation") || reason.includes("observed")) return "observation";

  return "analysis";
}

function clampTipAmount(amount: unknown): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return 1;
  return Math.min(10, Math.max(1, amount));
}

/** Max tip API fallback (direct transfer) attempts per session to prevent unlimited unvalidated spending. */
const MAX_TIP_FALLBACKS_PER_SESSION = 3;
let tipFallbackCount = 0;

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
          // Resolve target: if targetType is "agent", find their recent post txHash
          let engageTxHash = action.target!;
          const agentAddress = action.target!;
          if (action.targetType === "agent") {
            // Use topic hint from metadata to prefer a post matching the verified topic
            const topics = action.metadata?.topics as string[] | undefined;
            const topicHint = topics?.[0];
            const resolved = resolveAgentToRecentPost(deps.colonyDb, agentAddress, topicHint);
            if (!resolved) {
              result.skipped.push({ action, reason: `Could not resolve agent ${agentAddress} to a recent post` });
              deps.observe("insight", `ENGAGE skipped: no recent post found for agent ${agentAddress}`, {
                actionType: action.type,
                target: agentAddress,
              });
              break;
            }
            engageTxHash = resolved;
          }
          // Phase 8c: Verification gate — skip ENGAGE only if attestation explicitly failed.
          // "no_attestation" is allowed (treated like "unresolved") — many valid posts
          // simply haven't been attested yet. Only "failed" is a hard block.
          if (deps.colonyDb) {
            const gate = getPostVerificationGate(deps.colonyDb, engageTxHash);
            if (gate === "failed") {
              result.skipped.push({ action, reason: `Attestation ${gate} for ${engageTxHash}` });
              deps.observe("insight", `ENGAGE skipped: attestation ${gate}`, {
                actionType: action.type, target: engageTxHash, gate,
              });
              break;
            }
          }
          await reactToPost(deps.bridge, engageTxHash, "agree");
          result.executed.push({ action, success: true });
          deps.observe("insight", `Strategy ENGAGE executed for ${engageTxHash}`, {
            actionType: action.type,
            target: engageTxHash,
            originalTarget: agentAddress,
          });
          if (deps.colonyDb && deps.ourAddress) {
            try {
              recordInteraction(deps.colonyDb, {
                ourTxHash: `agree:${engageTxHash}`,
                theirTxHash: engageTxHash,
                theirAddress: (action.metadata?.author as string) ?? agentAddress,
                interactionType: "agreed",
                timestamp: new Date().toISOString(),
              });
            } catch (err: unknown) { deps.observe("warning", `Interaction tracking failed: ${err instanceof Error ? err.message : String(err)}`, { source: "action-executor:engage-interaction" }); }
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
            } catch (err: unknown) { deps.observe("warning", `Interaction tracking failed: ${err instanceof Error ? err.message : String(err)}`, { source: "action-executor:reply-interaction" }); }
          }
          break;
        }

        case "PUBLISH": {
          const text = await deps.generateText!(action);
          const publishResult = await deps.bridge.publishHivePost({
            text,
            category: inferCategory(action),
          });
          result.executed.push({ action, success: true, txHash: publishResult.txHash });
          deps.observe("insight", "Strategy PUBLISH executed", {
            actionType: action.type,
            txHash: publishResult.txHash,
          });
          break;
        }

        case "TIP": {
          const rawAmount = action.metadata?.amount;
          const amount = clampTipAmount(rawAmount);
          if (typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount !== amount) {
            deps.observe("warning", `TIP amount clamped: ${rawAmount} -> ${amount} (range 1-10)`, {
              source: "action-executor:tip-clamp", original: rawAmount, clamped: amount,
            });
          }
          const postTxHash = (action.metadata?.postTxHash as string) ?? action.target!;

          // Phase 8c: Verification gate — TIP requires positive verification (stricter than ENGAGE).
          // INTENTIONALLY STRICT (H9): TIP spends real DEM tokens, so we require "verified"
          // attestation status. Unlike ENGAGE (which allows "no_attestation" and "unresolved"),
          // TIP must not send funds to content that hasn't been positively verified.
          // Only check if we have an actual post txHash (not a wallet address).
          // Engine-generated tips set target=address with no postTxHash in metadata,
          // so resolve to a recent post first.
          if (deps.colonyDb) {
            let verifyTxHash = action.metadata?.postTxHash as string | undefined;
            if (!verifyTxHash) {
              verifyTxHash = resolveAgentToRecentPost(deps.colonyDb, action.target!) ?? undefined;
            }
            if (verifyTxHash) {
              const gate = getPostVerificationGate(deps.colonyDb, verifyTxHash);
              if (gate !== "verified") {
                result.skipped.push({ action, reason: `TIP requires verified attestation, got ${gate}` });
                deps.observe("insight", `TIP skipped: attestation ${gate} (requires verified)`, {
                  actionType: action.type, target: action.target, postTxHash: verifyTxHash, gate,
                });
                break;
              }
            }
            // If no post found to verify, allow the tip — API validation is the primary guard
          }

          // 2-step tipping: API validates spam limits → SDK transfer.
          // NOTE: SDK transfer() has no memo param — HIVE_TIP:{postTxHash} attribution
          // is not possible until SDK adds memo support. Tips are validated but unattributed.
          let recipient = action.target!;
          try {
            const tipValidation = await deps.bridge.apiCall("/api/tip", {
              method: "POST",
              body: JSON.stringify({ postTxHash, amount }),
              headers: { "Content-Type": "application/json" },
            });
            // Abort on any non-ok API response (4xx/5xx = hard denial, not fallback)
            if (!tipValidation.ok) {
              result.skipped.push({ action, reason: `Tip API rejected: status ${tipValidation.status}` });
              deps.observe("insight", `TIP rejected by API: status ${tipValidation.status}`, {
                actionType: action.type, target: action.target, postTxHash,
              });
              continue;
            }
            if (tipValidation.data && typeof tipValidation.data === "object") {
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
            // Transport failure only (network timeout, DNS) — fall back to direct transfer.
            // Rate-limited to MAX_TIP_FALLBACKS_PER_SESSION to prevent unlimited unvalidated spending.
            tipFallbackCount++;
            if (tipFallbackCount > MAX_TIP_FALLBACKS_PER_SESSION) {
              result.skipped.push({ action, reason: `Tip API fallback limit reached (${MAX_TIP_FALLBACKS_PER_SESSION} per session)` });
              deps.observe("warning", `TIP skipped: fallback limit reached (${tipFallbackCount - 1}/${MAX_TIP_FALLBACKS_PER_SESSION})`, {
                source: "action-executor:tip-fallback-limit", target: action.target,
              });
              continue;
            }
            deps.observe("warning", `Tip API unreachable, using direct transfer fallback (${tipFallbackCount}/${MAX_TIP_FALLBACKS_PER_SESSION})`, {
              source: "action-executor:tip-fallback", target: action.target,
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
            } catch (err: unknown) { deps.observe("warning", `Interaction tracking failed: ${err instanceof Error ? err.message : String(err)}`, { source: "action-executor:tip-interaction" }); }
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
