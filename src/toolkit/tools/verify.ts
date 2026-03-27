/**
 * verify() — check indexer confirmation of a transaction.
 *
 * REQUIRES SuperColony API (feed indexer) — no direct chain tx query exists in SDK.
 * When API is unavailable, retries exhaust and returns CONFIRM_TIMEOUT.
 * Retries with delays [3s, 5s, 10s].
 */

import type { VerifyOptions, VerifyResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { sleep } from "../guards/state-helpers.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateInput, VerifyOptionsSchema } from "../schemas.js";
import { parseFeedPosts } from "./feed-parser.js";

// Delays before each retry attempt (initial attempt has no delay)
const RETRY_DELAYS_MS = [3000, 5000, 10000];

/**
 * Verify on-chain confirmation of a transaction.
 *
 * Attempts once immediately, then retries with the delays above.
 * On confirmation: returns immediately. On timeout: returns the last error.
 */
export async function verify(
  session: DemosSession,
  opts: VerifyOptions,
): Promise<ToolResult<VerifyResult>> {
  return withToolWrapper(session, "verify", "CONFIRM_TIMEOUT", async (start) => {
    const inputError = validateInput(VerifyOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    // [0, ...delays] gives one immediate attempt + N retried attempts
    const attempts = [0, ...RETRY_DELAYS_MS];
    let lastError: Error | undefined;

    for (const delay of attempts) {
      if (delay > 0) await sleep(delay);

      try {
        const result = await checkConfirmation(session, opts.txHash);
        if (result.confirmed) {
          return ok<VerifyResult>(result, localProvenance(start));
        }
      } catch (e) {
        lastError = e as Error;
      }
    }

    // All attempts exhausted — return timeout with last error if any
    if (lastError) {
      return err(
        demosError(
          "CONFIRM_TIMEOUT",
          `Verification failed after ${RETRY_DELAYS_MS.length} retries: ${lastError.message}`,
          true,
          { step: "confirm", txHash: opts.txHash },
        ),
        localProvenance(start),
      );
    }

    return ok<VerifyResult>({ confirmed: false }, localProvenance(start));
  });
}

async function checkConfirmation(session: DemosSession, txHash: string): Promise<VerifyResult> {
  // Verification requires SuperColony API (feed indexer) — no chain-level tx query exists.
  // When API is down, this throws and verify() retries per its retry schedule.
  try {
    const bridge = session.getBridge();
    // Note: only checks last 50 posts — transactions older than the feed window return as unconfirmed
    const result = await bridge.apiCall(`/api/feed?limit=50`);
    if (!result.ok) {
      throw new Error(`Feed API returned ${result.status} — SuperColony API may be down`);
    }

    const posts = parseFeedPosts(result.data);
    const found = posts.some((p) => p.txHash === txHash);

    return { confirmed: found };
  } catch (e) {
    // API unavailable — throw so verify() retries
    throw new Error(`Verification requires SuperColony API (feed indexer): ${(e as Error).message}`);
  }
}
