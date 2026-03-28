/**
 * verify() — check on-chain confirmation of a transaction.
 *
 * Chain-first: uses bridge.verifyTransaction (getTxByHash) as primary path.
 * Retries with delays [3s, 5s, 10s] to handle block propagation delay.
 */

import type { VerifyOptions, VerifyResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { sleep } from "../guards/state-helpers.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateInput, VerifyOptionsSchema } from "../schemas.js";

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

    const bridge = session.getBridge();

    // [0, ...delays] gives one immediate attempt + N retried attempts
    const attempts = [0, ...RETRY_DELAYS_MS];
    let lastError: Error | undefined;

    for (const delay of attempts) {
      if (delay > 0) await sleep(delay);

      try {
        const result = await bridge.verifyTransaction(opts.txHash);
        if (result && result.confirmed) {
          return ok<VerifyResult>(
            { confirmed: true, blockHeight: result.blockNumber },
            localProvenance(start),
          );
        }
        // result is null (method unavailable) or unconfirmed — keep retrying
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

    return err(
      demosError(
        "CONFIRM_TIMEOUT",
        `Transaction ${opts.txHash.slice(0, 16)}... not confirmed after ${RETRY_DELAYS_MS.length} retries`,
        true,
        { step: "confirm", txHash: opts.txHash },
      ),
      localProvenance(start),
    );
  });
}
