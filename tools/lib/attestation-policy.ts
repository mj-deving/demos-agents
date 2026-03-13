import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
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

interface SourceRegistry {
  sources?: SourceRecord[];
}

export interface AttestationPlan {
  required: AttestationType;
  fallback: AttestationType | null;
  sensitive: boolean;
  reason: string;
}

const ASSET_MAP: Array<[RegExp, string, string]> = [
  [/\bbitcoin|\bbtc\b/, "bitcoin", "BTC"],
  [/\bethereum|\beth\b/, "ethereum", "ETH"],
  [/\bsolana|\bsol\b/, "solana", "SOL"],
  [/\bchainlink|\blink\b/, "chainlink", "LINK"],
];

export function loadSourceRegistry(path: string): SourceRecord[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = parseYaml(readFileSync(path, "utf-8")) as SourceRegistry;
    const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
    return sources.filter((s) => !!s?.name && !!s?.url);
  } catch {
    return [];
  }
}

function tokenizeTopic(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2)
  );
}

function sourceTopicTokens(source: SourceRecord): Set<string> {
  const out = new Set<string>();
  for (const tag of source.topics || []) {
    for (const tok of String(tag).toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 2) out.add(tok);
    }
  }
  return out;
}

function unresolvedPlaceholders(url: string): string[] {
  const matches = url.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

function inferAssetAlias(topic: string): { asset: string; symbol: string } | null {
  const t = topic.toLowerCase();
  for (const [rx, asset, symbol] of ASSET_MAP) {
    if (rx.test(t)) return { asset, symbol };
  }
  return null;
}

function extractTopicVars(topic: string): Record<string, string> {
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

function fillUrlTemplate(url: string, vars: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key in vars) return encodeURIComponent(vars[key]);
    return match;
  });
}

function isSourceCompatible(source: SourceRecord, method: AttestationType): boolean {
  return method === "TLSN" ? source.tlsn_safe === true : source.dahr_safe === true;
}

export function selectSourceForTopic(
  topic: string,
  sources: SourceRecord[],
  method: AttestationType
): { source: SourceRecord; url: string } | null {
  if (sources.length === 0) return null;

  const vars = extractTopicVars(topic);
  const topicWords = tokenizeTopic(topic);
  const alias = inferAssetAlias(topic);
  if (alias) {
    topicWords.add(alias.asset.toLowerCase());
    topicWords.add(alias.symbol.toLowerCase());
  }

  const ranked = sources
    .map((source) => {
      let score = 0;
      let overlap = 0;
      const tags = sourceTopicTokens(source);
      for (const w of topicWords) {
        if (tags.has(w)) overlap++;
      }
      if (overlap > 0) score += overlap * 4;
      if (overlap > 0) {
        for (const w of topicWords) {
          if (w.length >= 3 && source.name.toLowerCase().includes(w)) score += 1;
        }
      }
      if (source.tlsn_safe) score += 1;
      if (source.dahr_safe) score += 1;
      if ((source.max_response_kb || 999) <= 16) score += 1;

      const resolvedUrl = fillUrlTemplate(source.url, vars);
      const unresolved = unresolvedPlaceholders(resolvedUrl);
      return { source, score, overlap, resolvedUrl, unresolved };
    })
    .filter((x) => isSourceCompatible(x.source, method))
    .filter((x) => x.overlap > 0)
    .filter((x) => x.unresolved.length === 0)
    .sort((a, b) => b.score - a.score || (a.source.max_response_kb || 999) - (b.source.max_response_kb || 999));

  const chosen = ranked[0];
  if (!chosen) return null;
  return { source: chosen.source, url: chosen.resolvedUrl };
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

// ── Preflight ─────────────────────────────────────

export interface PreflightResult {
  pass: boolean;
  reason: string;
  reasonCode: "PASS" | "NO_MATCHING_SOURCE" | "TLSN_REQUIRED_NO_TLSN_SOURCE" | "SOURCE_PRECHECK_HTTP_ERROR";
}

/**
 * Quick check: can we attest a source for this topic?
 * Uses existing selectSourceForTopic + resolveAttestationPlan.
 * Does NOT do network calls — just checks registry availability.
 */
export function preflight(
  topic: string,
  sources: SourceRecord[],
  config: AgentConfig
): PreflightResult {
  const plan = resolveAttestationPlan(topic, config);

  const hasRequired = selectSourceForTopic(topic, sources, plan.required) !== null;
  const hasFallback = plan.fallback
    ? selectSourceForTopic(topic, sources, plan.fallback) !== null
    : false;

  if (hasRequired) {
    return { pass: true, reason: `${plan.required} source available`, reasonCode: "PASS" };
  }
  if (hasFallback) {
    return { pass: true, reason: `Fallback ${plan.fallback} source available`, reasonCode: "PASS" };
  }

  if (plan.required === "TLSN" && !plan.fallback) {
    return {
      pass: false,
      reason: `Topic "${topic}" requires TLSN but no TLSN-safe source found`,
      reasonCode: "TLSN_REQUIRED_NO_TLSN_SOURCE",
    };
  }

  return {
    pass: false,
    reason: `No matching ${plan.required}${plan.fallback ? `/${plan.fallback}` : ""} source for topic "${topic}"`,
    reasonCode: "NO_MATCHING_SOURCE",
  };
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

