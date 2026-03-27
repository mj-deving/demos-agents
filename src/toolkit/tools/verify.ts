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

const RETRY_DELAYS_MS = [3000, 5000, 10000];

/**
 * Verify on-chain confirmation of a transaction.
 */
export async function verify(
  session: DemosSession,
  opts: VerifyOptions,
): Promise<ToolResult<VerifyResult>> {
  return withToolWrapper(session, "verify", "CONFIRM_TIMEOUT", async (start) => {
    if (!opts.txHash) {
      return err(demosError("INVALID_INPUT", "txHash is required", false), localProvenance(start));
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }

      try {
        const result = await checkConfirmation(session, opts.txHash);

        if (result.confirmed) {
          return ok<VerifyResult>(result, localProvenance(start));
        }

        if (attempt < RETRY_DELAYS_MS.length) continue;

        return ok<VerifyResult>({ confirmed: false }, localProvenance(start));
      } catch (e) {
        if (attempt >= RETRY_DELAYS_MS.length) {
          return err(
            demosError(
              "CONFIRM_TIMEOUT",
              `Verification failed after ${RETRY_DELAYS_MS.length} retries: ${(e as Error).message}`,
              true,
              { step: "confirm", txHash: opts.txHash },
            ),
            localProvenance(start),
          );
        }
      }
    }

    return err(
      demosError("CONFIRM_TIMEOUT", "Verification exhausted all retries", true),
      localProvenance(start),
    );
  });
}

async function checkConfirmation(session: DemosSession, txHash: string): Promise<VerifyResult> {
  // Verification requires SuperColony API (feed indexer) — no chain-level tx query exists.
  // When API is down, this throws and verify() retries per its retry schedule.
  try {
    const bridge = session.getBridge();
    const result = await bridge.apiCall(`/api/feed?limit=20`);
    if (!result.ok) {
      throw new Error(`Feed API returned ${result.status} — SuperColony API may be down`);
    }

    const data = result.data as Record<string, unknown>;
    const posts = (data?.posts ?? data?.results ?? data) as unknown[];
    if (!Array.isArray(posts)) {
      throw new Error("Unexpected feed response shape");
    }

    const found = posts.some((p: unknown) => {
      const post = p as Record<string, unknown>;
      return String(post.txHash ?? "") === txHash;
    });

    return { confirmed: found, blockHeight: found ? 1 : undefined };
  } catch (e) {
    // API unavailable — throw so verify() retries
    throw new Error(`Verification requires SuperColony API (feed indexer): ${(e as Error).message}`);
  }
}
