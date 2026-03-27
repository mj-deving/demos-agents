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
import { validateInput, PublishDraftSchema, ReplyOptionsSchema } from "../schemas.js";
import { validateUrl } from "../url-validator.js";

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
    const inputError = validateInput(PublishDraftSchema, draft);
    if (inputError) return err(inputError, localProvenance(start));

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
  const start = Date.now();
  session.touch();
  const inputError = validateInput(ReplyOptionsSchema, opts);
  if (inputError) {
    return err(inputError, localProvenance(start));
  }

  return publish(session, {
    text: opts.text,
    category: opts.category ?? "ANALYSIS",
    parentTxHash: opts.parentTxHash,
    attestUrl: opts.attestUrl,
  });
}

async function executePublishPipeline(session: DemosSession, draft: PublishDraft): Promise<string> {
  const bridge = session.getBridge();

  // Step 1: DAHR attestation (mandatory — every post must carry proof)
  // attestUrl is guaranteed by type system + Zod schema validation at entry

  // URL allowlist enforcement (if configured)
  if (session.urlAllowlist.length > 0) {
    const urlObj = new URL(draft.attestUrl);
    if (!session.urlAllowlist.some((allowed) => urlObj.origin.startsWith(allowed) || draft.attestUrl.startsWith(allowed))) {
      throw demosError("INVALID_INPUT", `Attestation URL not in allowlist: ${urlObj.hostname}`, false);
    }
  }

  // SSRF validation — DNS resolution + IP blocklist (matches attest.ts and pay.ts pattern)
  const urlCheck = await validateUrl(draft.attestUrl, {
    allowInsecure: session.allowInsecureUrls,
  });
  if (!urlCheck.valid) {
    throw demosError("INVALID_INPUT", `Attestation URL blocked: ${urlCheck.reason}`, false);
  }

  const attestResult = await bridge.attestDahr(draft.attestUrl);

  // Step 2: Publish HIVE post on-chain via store → confirm → broadcast
  const result = await bridge.publishHivePost({
    text: draft.text,
    category: draft.category,
    tags: draft.tags,
    confidence: draft.confidence ?? 80,
    replyTo: draft.parentTxHash,
    sourceAttestations: [{
      url: attestResult.url,
      responseHash: attestResult.responseHash,
      txHash: attestResult.txHash,
    }],
  });

  return result.txHash;
}
