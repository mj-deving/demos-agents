/**
 * react() — agree, disagree, flag, or remove reaction on a post.
 *
 * API-only: reactions are tracked by SuperColony's backend, not on-chain.
 * Uses POST /api/feed/{txHash}/react with body { type }.
 *
 * Also provides getReactionCounts() for reading reaction tallies.
 */

import type { ReactOptions, ReactResult, ReactionCounts, ReactionType, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateInput, ReactOptionsSchema } from "../schemas.js";

// ── Shared reaction helper (used by CLI callers without full DemosSession) ──

interface ReactionBridge {
  apiCall(path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }>;
}

/**
 * Post a reaction to a post via SuperColony API.
 *
 * Shared helper for all call sites that need to react to a post.
 * Avoids duplicating the URL pattern + error check across CLI files.
 */
export async function reactToPost(
  bridge: ReactionBridge,
  txHash: string,
  type: ReactionType,
): Promise<void> {
  const result = await bridge.apiCall(
    `/api/feed/${encodeURIComponent(txHash)}/react`,
    { method: "POST", body: JSON.stringify({ type }) },
  );
  if (!result.ok) {
    throw new Error(`Reaction API returned ${result.status}`);
  }
}

/**
 * React to a post via SuperColony API.
 *
 * Requires apiAccess === "authenticated". Returns error in chain-only mode
 * since reactions are API-only (not on-chain).
 */
export async function react(
  session: DemosSession,
  opts: ReactOptions,
): Promise<ToolResult<ReactResult>> {
  return withToolWrapper(session, "react", "NETWORK_ERROR", async (start) => {
    const inputError = validateInput(ReactOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    const bridge = session.getBridge();

    if (bridge.apiAccess !== "authenticated") {
      return err(
        demosError("NETWORK_ERROR", "Reactions require API access — not available in chain-only mode", false),
        localProvenance(start),
      );
    }

    try {
      const result = await bridge.apiCall(
        `/api/feed/${encodeURIComponent(opts.txHash)}/react`,
        { method: "POST", body: JSON.stringify({ type: opts.type }) },
      );

      if (result.ok) {
        return ok<ReactResult>({ success: true }, localProvenance(start));
      }

      return err(
        demosError("TX_FAILED", `Reaction API returned ${result.status}: ${JSON.stringify(result.data)}`, true),
        localProvenance(start),
      );
    } catch (apiErr) {
      return err(
        demosError("NETWORK_ERROR", `Reaction API call failed: ${(apiErr as Error).message}`, true),
        localProvenance(start),
      );
    }
  });
}

/**
 * Get reaction counts for a post via SuperColony API.
 *
 * Returns { agree, disagree, flag } counts, or null if API unavailable.
 */
export async function getReactionCounts(
  session: DemosSession,
  txHash: string,
): Promise<ReactionCounts | null> {
  const bridge = session.getBridge();

  if (bridge.apiAccess !== "authenticated") {
    return null;
  }

  try {
    const result = await bridge.apiCall(
      `/api/feed/${encodeURIComponent(txHash)}/react`,
      { method: "GET" },
    );

    if (!result.ok || !result.data || typeof result.data !== "object") {
      return null;
    }

    const data = result.data as Record<string, unknown>;
    return {
      agree: typeof data.agree === "number" ? data.agree : 0,
      disagree: typeof data.disagree === "number" ? data.disagree : 0,
      flag: typeof data.flag === "number" ? data.flag : 0,
    };
  } catch {
    return null;
  }
}
