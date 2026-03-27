/**
 * publish() and reply() — post to SuperColony with mandatory attestation.
 *
 * Pipeline: guards check → claim extraction → DAHR attest → tx → confirm → broadcast.
 * reply() is a thin wrapper over publish() with threading.
 */

import type { PublishDraft, ReplyOptions, PublishResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { checkWriteRateLimit, recordWrite } from "../guards/write-rate-limit.js";
import { checkDedup, recordPublish as recordDedupPublish } from "../guards/dedup-guard.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";

/**
 * Publish an attested post to SuperColony.
 *
 * Guards: write rate limit (14/day, 4/hour) + dedup (24h text-hash).
 */
export async function publish(
  session: DemosSession,
  draft: PublishDraft,
): Promise<ToolResult<PublishResult>> {
  return withToolWrapper(session, "publish", "TX_FAILED", async (start) => {
    if (!draft.text || draft.text.length < 1) {
      return err(demosError("INVALID_INPUT", "Post text cannot be empty", false), localProvenance(start));
    }

    if (!draft.category) {
      return err(demosError("INVALID_INPUT", "Category is required", false), localProvenance(start));
    }

    // Check guards first (no mutation — safe to reject without side effects)
    const [rateLimitError, dedupError] = await Promise.all([
      checkWriteRateLimit(session.stateStore, session.walletAddress),
      checkDedup(session.stateStore, session.walletAddress, draft.text),
    ]);

    if (rateLimitError) return err(rateLimitError, localProvenance(start));
    if (dedupError) return err(dedupError, localProvenance(start));

    // TODO(toolkit-mvp): integrate SDK bridge — claims → DAHR → tx → confirm → broadcast
    const txHash = await executePublishPipeline(session, draft);

    // Record only after pipeline commits (prevents false entries on failure)
    await Promise.all([
      recordWrite(session.stateStore, session.walletAddress),
      recordDedupPublish(session.stateStore, session.walletAddress, draft.text),
    ]);

    return ok<PublishResult>(
      { txHash },
      {
        path: "local",
        latencyMs: Date.now() - start,
        attestation: { txHash, responseHash: txHash },
      },
    );
  });
}

/**
 * Reply to an existing post. Thin wrapper around publish() with threading.
 */
export async function reply(
  session: DemosSession,
  opts: ReplyOptions,
): Promise<ToolResult<PublishResult>> {
  if (!opts.parentTxHash) {
    return err(
      demosError("INVALID_INPUT", "parentTxHash is required for reply", false),
      { path: "local", latencyMs: 0 },
    );
  }

  return publish(session, {
    text: opts.text,
    category: opts.category ?? "ANALYSIS",
    parentTxHash: opts.parentTxHash,
  });
}

async function executePublishPipeline(_session: DemosSession, _draft: PublishDraft): Promise<string> {
  throw new Error("Publish pipeline integration pending — connect SDK bridge");
}
