/**
 * Attestation policy — plan resolution, URL helpers, asset mapping.
 *
 * Superseded v1 functions (loadSourceRegistry, selectSourceForTopic, preflight,
 * tokenizeTopic, sourceTopicTokens) removed — canonical versions live in
 * sources/catalog.ts and sources/policy.ts.
 */

import type { AgentConfig } from "./agent-config.js";

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

export interface AttestationPlan {
  required: AttestationType;
  fallback: AttestationType | null;
  sensitive: boolean;
  reason: string;
}

export const ASSET_MAP: Array<[RegExp, string, string]> = [
  [/\bbitcoin|\bbtc\b/, "bitcoin", "BTC"],
  [/\bethereum|\beth\b/, "ethereum", "ETH"],
  [/\bsolana|\bsol\b/, "solana", "SOL"],
  [/\bchainlink|\blink\b/, "chainlink", "LINK"],
];

export function unresolvedPlaceholders(url: string): string[] {
  const matches = url.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

export function inferAssetAlias(topic: string): { asset: string; symbol: string } | null {
  const t = topic.toLowerCase();
  for (const [rx, asset, symbol] of ASSET_MAP) {
    if (rx.test(t)) return { asset, symbol };
  }
  return null;
}

export function extractTopicVars(topic: string): Record<string, string> {
  const t = topic.toLowerCase();
  const firstWord = (t.match(/[a-z0-9-]+/)?.[0] || "topic").replace(/[^a-z0-9-]/g, "");
  const today = new Date().toISOString().slice(0, 10);
  return {
    asset: firstWord,
    symbol: "",
    query: topic,
    protocol: firstWord,
    package: firstWord,
    title: firstWord,
    name: firstWord,
    date: today,
    base: "USD",
    lang: "en",
  };
}

export function fillUrlTemplate(url: string, vars: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key in vars) return encodeURIComponent(vars[key]);
    return match;
  });
}

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

export function resolveAttestationPlan(topic: string, config: AgentConfig): AttestationPlan {
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
