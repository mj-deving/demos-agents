/**
 * Action Executor — extracted from event-runner.ts for testability.
 *
 * Factory pattern: createActionExecutor(ctx) returns a bound function
 * matching startEventLoop's onAction callback signature.
 *
 * All dependencies are injected via ActionExecutorContext — no SDK imports,
 * no file I/O, no closures over module-level state.
 */

import type { AgentEvent, EventAction } from "../types.js";
import { toErrorMessage } from "../lib/util/errors.js";
import { addCapped } from "../reactive/own-tx-hashes.js";
import type { StateStore } from "../toolkit/types.js";
import type { PublishInput, PublishResult, PublishOptions } from "./publish-pipeline.js";
import type { GeneratePostInput, PostDraft } from "./llm.js";
import type { ObservationType, ObserveOptions } from "../lib/pipeline/observe.js";

// ── Type Aliases ────────────────────────────────────

/** Returns a fresh auth token (encapsulates refresh logic). */
export type TokenProvider = () => Promise<string>;

/** API call abstraction for testability. */
export type ApiCallFn = (
  path: string,
  token: string,
  opts?: { method?: string; body?: string },
) => Promise<{ ok: boolean; status?: number; data?: any }>;

/** Telemetry abstraction. */
export type ObserveFn = (
  type: ObservationType,
  message: string,
  options?: ObserveOptions,
) => void;

/** LLM generation abstraction — wraps generatePost. */
export type GeneratePostFn = (
  input: GeneratePostInput,
  llm: import("../lib/llm/llm-provider.js").LLMProvider,
  config: { agentName: string; personaMdPath: string; strategyYamlPath: string },
) => Promise<PostDraft>;

/** Publish pipeline abstraction — demos instance captured in closure at wiring time. */
export type AttestAndPublishFn = (
  input: PublishInput,
  attestUrl?: string,
  opts?: PublishOptions,
) => Promise<PublishResult>;

/** SDK transfer abstraction — demos instance captured in closure at wiring time. */
export type TransferFn = (
  recipient: string,
  amount: number,
  memo: string,
) => Promise<unknown>;

// ── Context Interface ───────────────────────────────

/**
 * All dependencies needed by the action executor.
 * Every field is injectable for testing. SDK-free.
 */
export interface ActionExecutorContext {
  // Identity
  agentName: string;
  address: string;
  dryRun: boolean;

  // Auth
  getToken: TokenProvider;

  // Budget
  dailyReactive: number;
  hourlyReactive: number;

  // Agent config slices
  calibrationOffset: number;
  personaMdPath: string;
  strategyYamlPath: string;

  // LLM (nullable — reply skipped if absent)
  llm: import("../lib/llm/llm-provider.js").LLMProvider | null;

  // Mutable state (shared reference)
  ownTxHashes: Set<string>;

  // Platform abstractions
  apiCall: ApiCallFn;
  generatePost: GeneratePostFn;
  attestAndPublish: AttestAndPublishFn;
  transfer: TransferFn;

  // Rate limiting (async, StateStore-backed)
  stateStore: StateStore;
  checkWriteRate: (store: StateStore, address: string) => Promise<{ allowed: boolean; reason: string }>;
  recordWrite: (store: StateStore, address: string) => Promise<void>;

  // Telemetry
  observe: ObserveFn;
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

// ── Factory ─────────────────────────────────────────

/**
 * Creates a bound action executor from context.
 * Returns a function matching startEventLoop's onAction signature.
 */
export function createActionExecutor(
  ctx: ActionExecutorContext,
): (event: AgentEvent, action: EventAction) => Promise<void> {
  return async (event: AgentEvent, action: EventAction): Promise<void> => {
    ctx.observe("insight", `Event action: ${action.type}`, {
      phase: "event-loop",
      source: `event-runner:${event.sourceId}`,
      data: { eventId: event.id, action },
    });

    if (action.type === "log_only") {
      ctx.info(`[event] ${action.params.reason || "logged"}`);
      return;
    }

    if (ctx.dryRun) {
      ctx.info(`[dry-run] Would execute: ${action.type} ${JSON.stringify(action.params)}`);
      return;
    }

    // Refresh auth token before any API action
    const token = await ctx.getToken();

    // Check write rate for publish/reply (async, StateStore-backed)
    if (action.type === "publish" || action.type === "reply") {
      const check = await ctx.checkWriteRate(ctx.stateStore, ctx.address);
      if (!check.allowed) {
        ctx.warn(`[event] Reactive budget exhausted: ${check.reason}`);
        ctx.observe("warning", `Reactive budget exhausted: ${check.reason}`, {
          phase: "event-loop",
          source: "event-runner:budget",
          data: { action, reason: check.reason },
        });
        return;
      }
    }

    switch (action.type) {
      case "react": {
        const txHash = String(action.params.txHash);
        const reaction = String(action.params.reaction);
        ctx.info(`[event] React ${reaction} to ${txHash}`);
        try {
          const res = await ctx.apiCall(
            `/api/feed/${encodeURIComponent(txHash)}/react`,
            token,
            { method: "POST", body: JSON.stringify({ type: reaction }) },
          );
          if (res.ok) {
            ctx.observe("insight", `Reacted ${reaction} to ${txHash}`, {
              phase: "event-loop",
              source: "event-runner:react",
              data: { txHash, reaction },
            });
          } else {
            ctx.warn(`[event] React failed (${res.status}): ${JSON.stringify(res.data)}`);
            ctx.observe("failure", `React failed (${res.status})`, {
              phase: "event-loop",
              source: "event-runner:react",
              data: { txHash, reaction, status: res.status },
            });
          }
        } catch (err) {
          const msg = toErrorMessage(err);
          ctx.warn(`[event] React error: ${msg}`);
          ctx.observe("failure", `React error: ${msg}`, {
            phase: "event-loop",
            source: "event-runner:react",
            data: { txHash, error: msg },
          });
        }
        break;
      }
      case "reply": {
        const parentTx = String(action.params.parentTx);
        const question = String(action.params.question || "");
        ctx.info(`[event] Reply to ${parentTx}: ${question.slice(0, 50)}...`);
        try {
          if (!ctx.llm) {
            ctx.warn("[event] No LLM provider available — cannot generate reply");
            break;
          }
          const replyInput: GeneratePostInput = {
            topic: question,
            category: "ANALYSIS",
            scanContext: { activity_level: "reactive", posts_per_hour: 0 },
            calibrationOffset: ctx.calibrationOffset,
            replyTo: {
              txHash: parentTx,
              author: String(action.params.author || "unknown"),
              text: question,
            },
          };
          const draft = await ctx.generatePost(replyInput, ctx.llm, {
            agentName: ctx.agentName,
            personaMdPath: ctx.personaMdPath,
            strategyYamlPath: ctx.strategyYamlPath,
          });
          const publishInput: PublishInput = {
            text: draft.text,
            category: draft.category,
            tags: draft.tags,
            confidence: draft.confidence,
            replyTo: parentTx,
          };
          const result = await ctx.attestAndPublish(publishInput, undefined, { feedToken: token });
          addCapped(ctx.ownTxHashes, result.txHash);
          await ctx.recordWrite(ctx.stateStore, ctx.address);
          ctx.observe("insight", `Published reply ${result.txHash} to ${parentTx}`, {
            phase: "event-loop",
            source: "event-runner:reply",
            data: { txHash: result.txHash, parentTx, textLength: draft.text.length },
          });
        } catch (err) {
          const msg = toErrorMessage(err);
          ctx.warn(`[event] Reply error: ${msg}`);
          ctx.observe("failure", `Reply failed: ${msg}`, {
            phase: "event-loop",
            source: "event-runner:reply",
            data: { parentTx, error: msg },
          });
        }
        break;
      }
      case "publish": {
        const text = String(action.params.text || "");
        ctx.info(`[event] Publish: ${text.slice(0, 50)}...`);
        try {
          const publishInput: PublishInput = {
            text,
            category: String(action.params.category || "ANALYSIS"),
            tags: Array.isArray(action.params.tags) ? action.params.tags.map(String) : [],
            confidence: Number(action.params.confidence || 70),
          };
          const attestUrl = action.params.attestUrl ? String(action.params.attestUrl) : undefined;
          const result = await ctx.attestAndPublish(publishInput, attestUrl, { feedToken: token });
          addCapped(ctx.ownTxHashes, result.txHash);
          await ctx.recordWrite(ctx.stateStore, ctx.address);
          ctx.observe("insight", `Published ${result.txHash}`, {
            phase: "event-loop",
            source: "event-runner:publish",
            data: { txHash: result.txHash, category: publishInput.category, textLength: text.length },
          });
        } catch (err) {
          const msg = toErrorMessage(err);
          ctx.warn(`[event] Publish error: ${msg}`);
          ctx.observe("failure", `Publish failed: ${msg}`, {
            phase: "event-loop",
            source: "event-runner:publish",
            data: { error: msg },
          });
        }
        break;
      }
      case "tip": {
        const rawAmount = Number(action.params.amount || 1);
        // Defense-in-depth: clamp to absolute ceiling regardless of input source
        const tipAmount = Math.min(10, Math.max(1, Number.isFinite(rawAmount) ? rawAmount : 1));
        const postTxHash = String(action.params.txHash || "");
        ctx.info(`[event] Tip ${tipAmount} DEM for post ${postTxHash}`);
        try {
          const tipRes = await ctx.apiCall("/api/tip", token, {
            method: "POST",
            body: JSON.stringify({ postTxHash, amount: tipAmount }),
          });
          if (!tipRes.ok || !tipRes.data?.recipient) {
            ctx.warn(`[event] Tip validation failed: ${JSON.stringify(tipRes.data)}`);
            ctx.observe("failure", `Tip validation failed`, {
              phase: "event-loop",
              source: "event-runner:tip",
              data: { postTxHash, amount: tipAmount, status: tipRes.status },
            });
            break;
          }
          const recipient = String(tipRes.data.recipient).toLowerCase();

          const transferResult = await ctx.transfer(
            recipient,
            tipAmount,
            "",
          );
          ctx.observe("insight", `Tipped ${tipAmount} DEM to ${recipient}`, {
            phase: "event-loop",
            source: "event-runner:tip",
            data: { amount: tipAmount, recipient, postTxHash, result: transferResult },
          });
        } catch (err) {
          const msg = toErrorMessage(err);
          ctx.warn(`[event] Tip error: ${msg}`);
          ctx.observe("failure", `Tip failed: ${msg}`, {
            phase: "event-loop",
            source: "event-runner:tip",
            data: { postTxHash, amount: tipAmount, error: msg },
          });
        }
        break;
      }
      default:
        ctx.warn(`[event] Unknown action type: ${action.type}`);
        break;
    }
  };
}
