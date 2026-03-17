/**
 * Source policy — preflight check and source selection for the v2 loop.
 *
 * Phase 4: Uses provider adapters for URL generation instead of fillUrlTemplate.
 * Active/degraded sources without a registered non-generic adapter are rejected
 * from runtime (Codex P0.2).
 *
 * Import graph:
 *   policy.ts → ../attestation-policy.ts (resolveAttestationPlan)
 *   policy.ts → ./catalog.ts (types, tokenizeTopic, sourceTopicTokens)
 *   policy.ts → ./providers/index.ts (adapter registry)
 *   session-runner.ts → ./index.ts → policy.ts
 */

import {
  resolveAttestationPlan,
  inferAssetAlias,
  extractTopicVars,
  fillUrlTemplate,
  unresolvedPlaceholders,
  type AttestationType,
  type AttestationPlan,
} from "../attestation-policy.js";
import type { AgentConfig } from "../agent-config.js";
import {
  type AgentSourceView,
  type SourceRecordV2,
  tokenizeTopic,
  sourceTopicTokens,
} from "./catalog.js";
import { getProviderAdapter } from "./providers/index.js";
import type { CandidateRequest, AttestationMethod } from "./providers/types.js";

// ── Source Compatibility ────────────────────────────

function isSourceCompatible(source: SourceRecordV2, method: AttestationType): boolean {
  return method === "TLSN" ? source.tlsn_safe === true : source.dahr_safe === true;
}

/**
 * Check if a source has a registered non-generic adapter.
 * Active/degraded sources without one are rejected from runtime (Codex P0.2).
 */
function hasRegisteredAdapter(source: SourceRecordV2): boolean {
  if (source.provider === "generic") return false;
  const adapter = getProviderAdapter(source.provider);
  return adapter !== null && adapter.supports(source);
}

// ── Source Selection (V2) ───────────────────────────

export interface SourceSelectionResult {
  source: SourceRecordV2;
  url: string;
  score: number;
  /** Adapter-generated candidates (Phase 4) */
  adapterCandidates?: CandidateRequest[];
}

/**
 * Select the best source for a topic from a V2 source view.
 * Uses the inverted index for fast candidate lookup, then scores by
 * topic overlap, name match, method compatibility, and response size.
 *
 * Phase 4: Uses adapter.buildCandidates for URL generation when available.
 * Falls back to fillUrlTemplate for sources without adapters (quarantined).
 */
export function selectSourceForTopicV2(
  topic: string,
  sourceView: AgentSourceView,
  method: AttestationType,
  maxCandidatesPerTopic: number = 5
): SourceSelectionResult | null {
  const vars = extractTopicVars(topic);
  const topicWords = tokenizeTopic(topic);
  const alias = inferAssetAlias(topic);
  if (alias) {
    topicWords.add(alias.asset.toLowerCase());
    topicWords.add(alias.symbol.toLowerCase());
  }
  const tokens = [...topicWords];

  // Use index for fast candidate retrieval: gather all source IDs that match any topic token
  const candidateIds = new Set<string>();
  for (const token of topicWords) {
    const ids = sourceView.index.byTopicToken.get(token);
    if (ids) {
      for (const id of ids) candidateIds.add(id);
    }
  }

  // Also check domain tags
  for (const token of topicWords) {
    const ids = sourceView.index.byDomainTag.get(token);
    if (ids) {
      for (const id of ids) candidateIds.add(id);
    }
  }

  if (candidateIds.size === 0) return null;

  // Score candidates
  const ranked: SourceSelectionResult[] = [];

  for (const id of candidateIds) {
    const source = sourceView.index.byId.get(id);
    if (!source) continue;
    if (!isSourceCompatible(source, method)) continue;

    // Phase 4: Reject active/degraded generic sources from runtime
    if ((source.status === "active" || source.status === "degraded") && !hasRegisteredAdapter(source)) {
      continue;
    }

    let score = 0;
    const tags = sourceTopicTokens(source);
    let topicOverlap = 0;
    for (const w of topicWords) {
      if (tags.has(w)) topicOverlap++;
    }
    score += topicOverlap * 4;

    // Alias token overlap
    let aliasOverlap = 0;
    for (const a of source.topicAliases || []) {
      for (const tok of a.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length >= 2 && topicWords.has(tok)) aliasOverlap++;
      }
    }
    score += aliasOverlap * 3;

    // Domain tag overlap
    let domainOverlap = 0;
    for (const tag of source.domainTags) {
      if (topicWords.has(tag.toLowerCase())) domainOverlap++;
    }
    score += domainOverlap * 3;

    if (topicOverlap === 0 && aliasOverlap === 0 && domainOverlap === 0) continue;

    // Name match bonus
    for (const w of topicWords) {
      if (w.length >= 3 && source.name.toLowerCase().includes(w)) score += 1;
    }

    // Method preference bonus
    if (source.tlsn_safe) score += 1;
    if (source.dahr_safe) score += 1;

    // Small response bonus (TLSN-friendly)
    if ((source.max_response_kb || 999) <= 16) score += 1;

    // Source health penalty — prefer reliable sources over degraded/low-quality ones
    // -5 for degraded status: unreliable responses, may fail attestation
    if (source.status === "degraded") score -= 5;
    // -3 for low rating (<50): consistently poor quality (lifecycle degrades at 40, recovers at 60)
    if (source.rating?.overall != null && source.rating.overall < 50) score -= 3;

    // Phase 4: Use adapter for URL generation
    const adapter = getProviderAdapter(source.provider);
    let resolvedUrl: string;
    let adapterCandidates: CandidateRequest[] | undefined;

    if (adapter && adapter.supports(source)) {
      const candidates = adapter.buildCandidates({
        source,
        topic,
        tokens,
        vars,
        attestation: method as AttestationMethod,
        maxCandidates: maxCandidatesPerTopic,
      });

      if (candidates.length === 0) continue; // adapter can't build URL for this method

      // Validate all candidates once, apply URL rewrites
      const validatedCandidates: CandidateRequest[] = [];
      for (const c of candidates) {
        const v = adapter.validateCandidate(c);
        if (!v.ok) continue;
        validatedCandidates.push({ ...c, url: v.rewrittenUrl || c.url });
      }
      if (validatedCandidates.length === 0) continue;

      resolvedUrl = validatedCandidates[0].url;
      adapterCandidates = validatedCandidates;
    } else {
      // Fallback: fillUrlTemplate (only for quarantined/generic sources)
      resolvedUrl = fillUrlTemplate(source.url, vars);
      if (unresolvedPlaceholders(resolvedUrl).length > 0) continue;
    }

    ranked.push({ source, url: resolvedUrl, score, adapterCandidates });
  }

  if (ranked.length === 0) return null;

  // Sort by score desc, then by response size asc (prefer smaller for TLSN)
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (a.source.max_response_kb || 999) - (b.source.max_response_kb || 999)
  );

  return ranked[0];
}

// ── Preflight ──────────────────────────────────────

export interface PreflightCandidate {
  sourceId: string;
  source: SourceRecordV2;
  method: AttestationType;
  url: string;
  score: number;
  /** Adapter-generated candidates with validated URLs */
  adapterCandidates?: CandidateRequest[];
}

export interface PreflightResult {
  pass: boolean;
  reason: string;
  reasonCode: "PASS" | "NO_MATCHING_SOURCE" | "TLSN_REQUIRED_NO_TLSN_SOURCE" | "SOURCE_PRECHECK_HTTP_ERROR";
  candidates: PreflightCandidate[];
  plan: AttestationPlan;
}

/**
 * Quick check: can we attest a source for this topic?
 *
 * Uses catalog index for fast lookup. Returns candidates for downstream
 * `match()` to verify post-generation source alignment.
 *
 * Phase 4: Uses adapter.buildCandidates for URL generation.
 * No network calls — just checks registry availability.
 */
export function preflight(
  topic: string,
  sourceView: AgentSourceView,
  config: AgentConfig
): PreflightResult {
  const plan = resolveAttestationPlan(topic, config);
  const maxCandidates = 5; // default, from AgentSourceConfig
  const candidates: PreflightCandidate[] = [];

  // Try required method first
  const requiredSelection = selectSourceForTopicV2(topic, sourceView, plan.required, maxCandidates);
  if (requiredSelection) {
    candidates.push({
      sourceId: requiredSelection.source.id,
      source: requiredSelection.source,
      method: plan.required,
      url: requiredSelection.url,
      score: requiredSelection.score,
      adapterCandidates: requiredSelection.adapterCandidates,
    });
  }

  // Try fallback method if available
  if (plan.fallback) {
    const fallbackSelection = selectSourceForTopicV2(topic, sourceView, plan.fallback, maxCandidates);
    if (fallbackSelection) {
      // Only add if it's a different source+method combo
      if (!candidates.some((c) => c.sourceId === fallbackSelection.source.id && c.method === plan.fallback)) {
        candidates.push({
          sourceId: fallbackSelection.source.id,
          source: fallbackSelection.source,
          method: plan.fallback,
          url: fallbackSelection.url,
          score: fallbackSelection.score,
          adapterCandidates: fallbackSelection.adapterCandidates,
        });
      }
    }
  }

  if (candidates.length > 0) {
    const hasRequired = candidates.some((c) => c.method === plan.required);
    const reason = hasRequired
      ? `${plan.required} source available (${candidates.length} candidate(s))`
      : `${plan.fallback} fallback source available (${candidates.length} candidate(s), no ${plan.required} source)`;
    return {
      pass: true,
      reason,
      reasonCode: "PASS",
      candidates,
      plan,
    };
  }

  // No candidates found
  if (plan.required === "TLSN" && !plan.fallback) {
    return {
      pass: false,
      reason: `Topic "${topic}" requires TLSN but no TLSN-safe source found`,
      reasonCode: "TLSN_REQUIRED_NO_TLSN_SOURCE",
      candidates: [],
      plan,
    };
  }

  return {
    pass: false,
    reason: `No matching ${plan.required}${plan.fallback ? `/${plan.fallback}` : ""} source for topic "${topic}"`,
    reasonCode: "NO_MATCHING_SOURCE",
    candidates: [],
    plan,
  };
}
