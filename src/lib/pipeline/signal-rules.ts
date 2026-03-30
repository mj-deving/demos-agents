/**
 * Strategy-level signal rules and domain defaults.
 *
 * Keeps thresholds and domain policy separate from the orchestration in
 * signal-detection.ts and the reusable math in toolkit/math/baseline.ts.
 */

import type {
  SignalDetectionConfig,
  StalenessConfig,
} from "./signal-detection.js";

/** Anti-signal divergence threshold (%) — must be strictly greater */
export const ANTI_SIGNAL_DIVERGENCE_THRESHOLD = 10;

export const CRYPTO_DEFAULTS: SignalDetectionConfig = {
  changeThreshold: 5,
  domain: "crypto",
};

export const MACRO_DEFAULTS: SignalDetectionConfig = {
  changeThreshold: 2,
  domain: "macro",
};

export const UNKNOWN_DEFAULTS: SignalDetectionConfig = {
  changeThreshold: 5,
  domain: "unknown",
};

export const DEFAULT_STALENESS: StalenessConfig = {
  crypto: 15 * 60 * 1000,
  macro: 60 * 60 * 1000,
  unknown: 60 * 60 * 1000,
};

export const CRYPTO_TAGS = new Set(["crypto", "defi", "prices", "token", "blockchain"]);
export const MACRO_TAGS = new Set(["macro", "economics", "gdp", "inflation", "unemployment", "treasury", "debt"]);

/** Minimum |changePercent| for convergence inclusion */
export const CONVERGENCE_MAGNITUDE_THRESHOLD = 1;

/** Minimum distinct sources for convergence */
export const CONVERGENCE_MIN_SOURCES = 3;
