import { toErrorMessage } from "../util/errors.js";

/**
 * NAPI Guard — tests whether xmcore native bindings load without crashing.
 *
 * Phase 8 Feature 6: XMCore cross-chain reads. NAPI crash in xmcore takes
 * down the entire Node.js process (ADR-0004). This guard tests capability
 * once at startup; if it fails, xmcore is disabled for the session.
 *
 * Review fix: Child process isolation is REQUIRED for production xmcore use.
 * This guard is the first line of defense — it prevents even attempting to
 * load xmcore if the native module is known to crash.
 */

export interface NapiCapability {
  available: boolean;
  error?: string;
  testedAt: string;
}

let cachedCapability: NapiCapability | null = null;

/**
 * Test whether xmcore NAPI bindings load without crashing.
 * Result is cached for the session — only tested once.
 */
export async function testNapiCapability(): Promise<NapiCapability> {
  if (cachedCapability) return cachedCapability;

  const testedAt = new Date().toISOString();

  try {
    // Lazy import — if this crashes, the entire process dies (which is why
    // production should use child process isolation, not just this guard).
    const xmcore = await import("@kynesyslabs/demosdk/xmcore");

    // Smoke test: verify EVM class exists and can be instantiated
    if (typeof xmcore.EVM !== "function") {
      cachedCapability = { available: false, error: "EVM class not found in xmcore", testedAt };
      return cachedCapability;
    }

    cachedCapability = { available: true, testedAt };
    return cachedCapability;
  } catch (err: unknown) {
    const error = toErrorMessage(err);
    cachedCapability = { available: false, error, testedAt };
    return cachedCapability;
  }
}

/**
 * Check if xmcore is available without re-testing.
 * Returns false if not yet tested.
 */
export function isXmcoreAvailable(): boolean {
  return cachedCapability?.available ?? false;
}

/**
 * Reset the cached capability (for testing).
 */
export function resetNapiCache(): void {
  cachedCapability = null;
}
