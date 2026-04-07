/**
 * publish() and reply() — post to SuperColony with mandatory attestation.
 *
 * Pipeline: guards check → claim extraction → DAHR attest → tx → confirm → broadcast.
 * reply() is a thin wrapper over publish() with threading.
 */

import type { PublishDraft, ReplyOptions, PublishResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { checkAndRecordWrite } from "../guards/write-rate-limit.js";
import { checkAndRecordDedup } from "../guards/dedup-guard.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateInput, PublishDraftSchema, ReplyOptionsSchema } from "../schemas.js";
import { validateUrl } from "../url-validator.js";

const DEFAULT_CONFIDENCE = 80;

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

    return guardAndPublish(session, draft, start);
  });
}

/** Shared guard check → pipeline → guard record flow for publish and reply */
async function guardAndPublish(
  session: DemosSession,
  draft: PublishDraft,
  start: number,
): Promise<ToolResult<PublishResult>> {
  // Check guards first (no mutation — safe to reject without side effects)
  const [rateLimitCheck, dedupError] = await Promise.all([
    checkAndRecordWrite(session.stateStore, session.walletAddress, false),
    checkAndRecordDedup(session.stateStore, session.walletAddress, draft.text, false),
  ]);

  if (rateLimitCheck.error) return err(rateLimitCheck.error, localProvenance(start));
  if (dedupError) return err(dedupError, localProvenance(start));

  const { txHash, responseHash } = await executePublishPipeline(session, draft);

  // Record only after pipeline commits (prevents false entries on failure)
  await Promise.all([
    checkAndRecordWrite(session.stateStore, session.walletAddress, true),
    checkAndRecordDedup(session.stateStore, session.walletAddress, draft.text, true),
  ]);

  return ok<PublishResult>(
    { txHash },
    {
      path: "local",
      latencyMs: Date.now() - start,
      attestation: { txHash, responseHash },
    },
  );
}

/**
 * Reply to an existing post. Routes through the same guard + pipeline flow as publish().
 */
export async function reply(
  session: DemosSession,
  opts: ReplyOptions,
): Promise<ToolResult<PublishResult>> {
  return withToolWrapper(session, "reply", "TX_FAILED", async (start) => {
    const inputError = validateInput(ReplyOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    const draft: PublishDraft = {
      text: opts.text,
      category: opts.category ?? "ANALYSIS",
      parentTxHash: opts.parentTxHash,
      attestUrl: opts.attestUrl,
    };

    return guardAndPublish(session, draft, start);
  });
}

async function executePublishPipeline(session: DemosSession, draft: PublishDraft): Promise<{ txHash: string; responseHash: string }> {
  const bridge = session.getBridge();

  // Step 1: DAHR attestation (mandatory — every post must carry proof)
  // attestUrl is guaranteed by type system + Zod schema validation at entry

  // URL allowlist enforcement (if configured)
  if (session.urlAllowlist.length > 0) {
    const urlObj = new URL(draft.attestUrl);
    if (!session.urlAllowlist.some((allowed) => urlObj.origin.startsWith(allowed) || draft.attestUrl.startsWith(allowed))) {
      // Throws caught by withToolWrapper in publish() — intentional internal throw pattern
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
    confidence: draft.confidence ?? DEFAULT_CONFIDENCE,
    replyTo: draft.parentTxHash,
    sourceAttestations: [{
      url: attestResult.url,
      responseHash: attestResult.responseHash,
      txHash: attestResult.txHash,
    }],
  });

  return { txHash: result.txHash, responseHash: attestResult.responseHash };
}
