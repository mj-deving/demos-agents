/**
 * tip() — tip DEM to a post author with spending guards.
 *
 * Chain-first: uses bridge.resolvePostAuthor (getTxByHash) for recipient resolution.
 * No feed API fallback — all resolution is on-chain.
 */

import type { TipOptions, TipResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { checkAndRecordTip } from "../guards/tip-spend-cap.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateInput, TipOptionsSchema } from "../schemas.js";
import { simulateTransaction } from "../chain/tx-simulator.js";

/**
 * Tip DEM to a post author. Guards: max per-tip, max per-post, cooldown.
 */
export async function tip(
  session: DemosSession,
  opts: TipOptions,
): Promise<ToolResult<TipResult>> {
  return withToolWrapper(session, "tip", "TX_FAILED", async (start) => {
    const inputError = validateInput(TipOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    const capError = await checkAndRecordTip(
      session.stateStore,
      session.walletAddress,
      opts.txHash,
      opts.amount,
      session.tipPolicy,
      false, // check only — record after successful transfer
    );
    if (capError) {
      return err(capError, localProvenance(start));
    }

    const bridge = session.getBridge();

    // Chain-first: resolve post author address from on-chain transaction
    const recipientAddress = await bridge.resolvePostAuthor(opts.txHash);
    if (!recipientAddress) {
      return err(
        demosError("INVALID_INPUT", `Transaction ${opts.txHash.slice(0, 16)}... not found on chain — cannot resolve recipient`, false),
        localProvenance(start),
      );
    }

    // Self-tip guard — cannot tip your own posts
    if (recipientAddress.toLowerCase() === session.walletAddress.toLowerCase()) {
      return err(
        demosError("INVALID_INPUT", "Cannot self-tip — recipient is the sender", false),
        localProvenance(start),
      );
    }

    // TX Simulation Gate — dry-run before spending real DEM
    // Convert DEM amount to wei-equivalent hex for accurate balance check
    const valueWei = BigInt(opts.amount) * 10n ** 18n;
    const sim = await simulateTransaction({
      rpcUrl: session.rpcUrl,
      from: session.walletAddress,
      to: recipientAddress,
      data: "0x", // native transfer — no calldata
      value: `0x${valueWei.toString(16)}`,
      // failOpen defaults to false — tip is a money-moving path, must fail-closed
    });
    if (!sim.success) {
      return err(
        demosError("TX_FAILED", `Simulation rejected transfer: ${sim.error}`, false),
        localProvenance(start),
      );
    }
    if (sim.warning) {
      console.warn(`[tip] Simulation warning: ${sim.warning}`);
    }

    const result = await bridge.transferDem(recipientAddress, opts.amount, "");

    await checkAndRecordTip(
      session.stateStore,
      session.walletAddress,
      opts.txHash,
      opts.amount,
      session.tipPolicy,
      true, // record after successful transfer
    );

    return ok<TipResult>({ txHash: result.txHash }, localProvenance(start));
  });
}
