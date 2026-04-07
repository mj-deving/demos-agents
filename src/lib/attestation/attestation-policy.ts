/**
 * Attestation policy — plan resolution, URL helpers, asset mapping.
 *
 * Superseded v1 functions (loadSourceRegistry, selectSourceForTopic, preflight,
 * tokenizeTopic, sourceTopicTokens) removed — canonical versions live in
 * sources/catalog.ts and sources/policy.ts.
 */

import type { AgentConfig } from "../agent-config.js";
export {
  ASSET_MAP,
  MACRO_ENTITY_MAP,
  inferAssetAlias,
  inferMacroEntity,
} from "../../toolkit/chain/asset-helpers.js";

export type AttestationType = "DAHR" | "TLSN";

export interface SourceRecord {
  name: string;
  url: string;
  topics?: string[];
  tlsn_safe?: boolean;
  dahr_safe?: boolean;
  max_response_kb?: number;
  note?: string;
}

export interface AttestationMethodPlan {
  required: AttestationType;
  fallback: AttestationType | null;
  sensitive: boolean;
  reason: string;
}

export {
  unresolvedPlaceholders,
  extractTopicVars,
  fillUrlTemplate,
} from "../../toolkit/chain/url-helpers.js";

function normalizeTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

export function isHighSensitivityTopic(topic: string, keywords: string[]): boolean {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const topicNorm = topic.toLowerCase();
  const topicTokens = new Set(normalizeTokens(topicNorm));
  for (const kwRaw of keywords) {
    const kw = String(kwRaw || "").toLowerCase().trim();
    if (!kw) continue;
    if (topicNorm.includes(kw)) return true;
    const kwTokens = normalizeTokens(kw);
    if (kwTokens.length > 0 && kwTokens.every((k) => topicTokens.has(k))) return true;
  }
  return false;
}

// ── Attestation Plan ──────────────────────────────

export function resolveAttestationPlan(topic: string, config: AgentConfig): AttestationMethodPlan {
  const sensitive = isHighSensitivityTopic(topic, config.attestation.highSensitivityKeywords);

  if (sensitive && config.attestation.highSensitivityRequireTlsn) {
    return {
      required: "TLSN",
      fallback: null,
      sensitive: true,
      reason: "high-sensitivity topic requires TLSN by policy",
    };
  }

  switch (config.attestation.defaultMode) {
    case "tlsn_only":
      return {
        required: "TLSN",
        fallback: null,
        sensitive,
        reason: sensitive ? "sensitive topic + tlsn_only policy" : "tlsn_only policy",
      };
    case "tlsn_preferred":
      return {
        required: "TLSN",
        fallback: "DAHR",
        sensitive,
        reason: sensitive ? "sensitive topic with TLSN-preferred baseline" : "tlsn_preferred policy",
      };
    case "dahr_only":
    default:
      return {
        required: "DAHR",
        fallback: null,
        sensitive,
        reason: sensitive ? "sensitive topic but policy configured dahr_only" : "dahr_only policy",
      };
  }
}
