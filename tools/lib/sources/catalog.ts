/**
 * Source catalog — unified source registry with typed records and in-memory index.
 *
 * Replaces per-agent YAML registries with a single catalog.json file.
 * Records use SourceRecordV2 schema with lifecycle, rating, scope, and trust.
 * Index is rebuilt in-memory on load (140 sources doesn't justify persistence).
 *
 * Two API boundaries:
 *   - Runtime (this file): loadCatalog, loadAgentSourceView, buildSourceIndex
 *   - Admin (sources/admin.ts): discover, test, updateRatings (Phase 3 Step 3+)
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

// ── Source Status Lifecycle ──────────────────────────

/**
 * Canonical source status enum.
 * Authoritative definition — all other docs must match.
 *
 * Transitions:
 *   quarantined →(3 tests pass)→ active
 *   active →(rating < 40 or 3 fails)→ degraded
 *   degraded →(14 days, no recovery)→ stale
 *   stale →(30 days)→ deprecated
 *   any →(manual)→ archived
 *   archived →(manual)→ quarantined (re-enters validation)
 */
export type SourceStatus =
  | "quarantined"
  | "active"
  | "degraded"
  | "stale"
  | "deprecated"
  | "archived";

// ── Agent Types ─────────────────────────────────────

export type AgentName = "sentinel" | "crawler" | "pioneer";
export const ALL_AGENT_NAMES: AgentName[] = ["sentinel", "crawler", "pioneer"];

// ── Source Record V2 ────────────────────────────────

export interface SourceRecordV2 {
  // Identity
  id: string;                          // deterministic: provider + normalized urlPattern
  name: string;
  provider: string;                    // "coingecko" | "hn-algolia" | ...
  url: string;
  urlPattern: string;                  // normalized template (for dedupe)

  // Backward-compatible metadata
  topics?: string[];
  tlsn_safe?: boolean;
  dahr_safe?: boolean;
  max_response_kb?: number;
  note?: string;

  // Lookup metadata
  topicAliases?: string[];
  domainTags: string[];
  responseFormat: "json" | "xml" | "rss" | "html";

  // Agent scoping
  scope: {
    visibility: "global" | "scoped";
    agents?: AgentName[];              // required when visibility = "scoped"
    importedFrom: AgentName[];         // provenance from YAML migration
  };

  // Runtime fetch policy
  runtime: {
    timeoutMs: number;
    retry: {
      maxAttempts: number;
      backoffMs: number;
      retryOn: Array<"timeout" | "5xx" | "429">;
    };
  };

  // Adapter metadata (Phase 4)
  adapter?: {
    /** Operation discriminator within the provider (e.g., "search", "trending", "summary") */
    operation: string;
  };

  // Quality and lifecycle
  trustTier: "official" | "established" | "community" | "experimental";
  status: SourceStatus;
  rating: {
    overall: number;
    uptime: number;
    relevance: number;
    freshness: number;
    sizeStability: number;
    engagement: number;
    trust: number;
    lastTestedAt?: string;
    testCount: number;
    successCount: number;
    consecutiveFailures: number;
  };
  lifecycle: {
    discoveredAt: string;
    discoveredBy: "manual" | "import" | "auto-discovery";
    promotedAt?: string;
    deprecatedAt?: string;
    archivedAt?: string;
    /** ISO timestamp of the most recent status change (for time-based transitions) */
    statusChangedAt?: string;
    lastUsedAt?: string;
    lastFailedAt?: string;
    failureReason?: string;
  };
}

// ── Catalog File ────────────────────────────────────

export interface SourceCatalogFileV2 {
  version: 2;
  generatedAt: string;
  aliasesVersion: number;
  sources: SourceRecordV2[];
}

// ── Source Index ─────────────────────────────────────

export interface SourceIndex {
  byId: Map<string, SourceRecordV2>;
  byTopicToken: Map<string, Set<string>>;    // token → source IDs
  byDomainTag: Map<string, Set<string>>;
  byProvider: Map<string, Set<string>>;
  byAgent: Map<AgentName, Set<string>>;
  byMethod: { TLSN: Set<string>; DAHR: Set<string> };
}

// ── Agent Source Config ─────────────────────────────

export interface AgentSourceConfig {
  agent: AgentName;
  minRating: number;
  allowStatuses: SourceStatus[];
  maxCandidatesPerTopic: number;
}

export interface AgentSourceView {
  agent: AgentName;
  catalogVersion: 2 | 1;
  sources: SourceRecordV2[];
  index: SourceIndex;
}

// ── Registry Mode ───────────────────────────────────

export type SourceRegistryMode = "catalog-preferred" | "catalog-only" | "yaml-only";

const SOURCE_STATUSES: SourceStatus[] = [
  "quarantined",
  "active",
  "degraded",
  "stale",
  "deprecated",
  "archived",
];

const RESPONSE_FORMATS: SourceRecordV2["responseFormat"][] = ["json", "xml", "rss", "html"];
const SOURCE_VISIBILITIES: Array<SourceRecordV2["scope"]["visibility"]> = ["global", "scoped"];
const TRUST_TIERS: SourceRecordV2["trustTier"][] = [
  "official",
  "established",
  "community",
  "experimental",
];
const RETRY_ON_VALUES: Array<SourceRecordV2["runtime"]["retry"]["retryOn"][number]> = [
  "timeout",
  "5xx",
  "429",
];
const DISCOVERED_BY_VALUES: Array<SourceRecordV2["lifecycle"]["discoveredBy"]> = [
  "manual",
  "import",
  "auto-discovery",
];

// ── V1 Compat Types ────────────────────────────────

/** V1 source record from YAML registry (backward compat) */
export interface SourceRecordV1 {
  name: string;
  url: string;
  topics?: string[];
  tlsn_safe?: boolean;
  dahr_safe?: boolean;
  max_response_kb?: number;
  note?: string;
}

interface SourceRegistryV1 {
  version?: number;
  description?: string;
  sources?: SourceRecordV1[];
}

// ── Topic Tokenization ─────────────────────────────

/**
 * Tokenize a topic string into lowercase terms for index lookup.
 * Moved from attestation-policy.ts — canonical implementation.
 */
export function tokenizeTopic(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2)
  );
}

/**
 * Extract topic tokens from a source record's topics array.
 * Returns a fresh Set on every call — callers may mutate safely.
 * Moved from attestation-policy.ts — canonical implementation.
 */
export function sourceTopicTokens(source: SourceRecordV2 | SourceRecordV1): Set<string> {
  const out = new Set<string>();
  for (const tag of source.topics || []) {
    for (const tok of String(tag).toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 2) out.add(tok);
    }
  }
  return out;
}

// ── URL Normalization ───────────────────────────────

/**
 * Normalize a URL template for deduplication.
 * Strips protocol, trailing slashes, and sorts query params.
 */
export function normalizeUrlPattern(url: string): string {
  try {
    // Remove template variables for normalization
    const cleaned = url.replace(/\{[^}]+\}/g, "{VAR}");
    const parsed = new URL(cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const params = Array.from(parsed.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${parsed.host}${path}${params ? "?" + params : ""}`;
  } catch {
    return url.toLowerCase();
  }
}

// ── Provider Detection ──────────────────────────────

/** Provider → response format mapping for V1 conversion */
const PROVIDER_RESPONSE_FORMATS: Record<string, "json" | "xml" | "rss" | "html"> = {
  arxiv: "xml",
};

/**
 * Infer response format from URL path/extension when provider map doesn't cover it.
 * Catches RSS/XML feeds that live under JSON-default providers (e.g., pypi.org/rss/).
 */
function inferResponseFormat(url: string, provider: string): "json" | "xml" | "rss" | "html" {
  if (PROVIDER_RESPONSE_FORMATS[provider]) return PROVIDER_RESPONSE_FORMATS[provider];
  const lower = url.toLowerCase();
  if (lower.includes("/rss") || lower.endsWith(".rss")) return "rss";
  if (lower.endsWith(".xml") || lower.includes("/atom") || lower.includes("/feed.xml")) return "xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "json";
}

/**
 * Infer provider from URL.
 */
export function inferProvider(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("coingecko.com")) return "coingecko";
  if (lower.includes("hn.algolia.com")) return "hn-algolia";
  if (lower.includes("api.github.com")) return "github";
  if (lower.includes("llama.fi")) return "defillama";
  if (lower.includes("api.binance.com")) return "binance";
  if (lower.includes("api.kraken.com")) return "kraken";
  if (lower.includes("arxiv.org")) return "arxiv";
  if (lower.includes("wikipedia.org")) return "wikipedia";
  if (lower.includes("worldbank.org")) return "worldbank";
  if (lower.includes("pypi.org")) return "pypi";
  if (lower.includes("ncbi.nlm.nih.gov") || lower.includes("pubmed")) return "pubmed";
  return "generic";
}

/**
 * Generate a deterministic source ID from provider and already-normalized URL pattern.
 */
function generateSourceId(provider: string, normalizedUrlPattern: string): string {
  let hash = 0;
  for (let i = 0; i < normalizedUrlPattern.length; i++) {
    const char = normalizedUrlPattern.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  const hexHash = Math.abs(hash).toString(16).padStart(8, "0");
  return `${provider}-${hexHash}`;
}

// ── V1 → V2 Conversion ─────────────────────────────

/**
 * Convert a V1 YAML source record to V2 format.
 * Used during migration and when loading YAML fallback.
 *
 * @param v1 - V1 source record from YAML
 * @param importedFrom - which agent's YAML this was loaded from
 * @param timestamp - ISO timestamp for lifecycle.discoveredAt (optional, avoids repeated Date allocations)
 */
export function normalizeSourceRecord(
  v1: SourceRecordV1,
  importedFrom: AgentName = "sentinel",
  timestamp?: string
): SourceRecordV2 {
  const provider = inferProvider(v1.url);
  const urlPattern = normalizeUrlPattern(v1.url);
  const id = generateSourceId(provider, urlPattern);

  // Infer domain tags from topics (deduplicated via Set)
  const domainTags = [...new Set((v1.topics || []).map((t) => t.toLowerCase()))];

  // Infer response format from provider + URL path
  const responseFormat = inferResponseFormat(v1.url, provider);

  return {
    id,
    name: v1.name,
    provider,
    url: v1.url,
    urlPattern,

    topics: v1.topics,
    tlsn_safe: v1.tlsn_safe,
    dahr_safe: v1.dahr_safe,
    max_response_kb: v1.max_response_kb,
    note: v1.note,

    topicAliases: [],
    domainTags,
    responseFormat,

    scope: {
      visibility: "scoped",
      agents: [importedFrom],
      importedFrom: [importedFrom],
    },

    runtime: {
      timeoutMs: 8000,
      retry: {
        maxAttempts: 2,
        backoffMs: 1000,
        retryOn: ["timeout", "5xx"],
      },
    },

    trustTier: "established",
    status: "active",
    rating: {
      overall: 50,
      uptime: 50,
      relevance: 50,
      freshness: 50,
      sizeStability: 50,
      engagement: 50,
      trust: 50,
      testCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: timestamp || new Date().toISOString(),
      discoveredBy: "import",
    },
  };
}

// ── Index Building ──────────────────────────────────

/**
 * Build an in-memory inverted index from source records.
 * Rebuilt on every load — 140 sources is fast enough that persistence
 * would add complexity without meaningful benefit.
 */
export function buildSourceIndex(sources: SourceRecordV2[]): SourceIndex {
  const index: SourceIndex = {
    byId: new Map(),
    byTopicToken: new Map(),
    byDomainTag: new Map(),
    byProvider: new Map(),
    byAgent: new Map(),
    byMethod: { TLSN: new Set(), DAHR: new Set() },
  };

  for (const source of sources) {
    // byId
    index.byId.set(source.id, source);

    // byTopicToken — sourceTopicTokens returns a fresh Set, safe to mutate
    const tokens = sourceTopicTokens(source);
    for (const alias of source.topicAliases || []) {
      for (const tok of alias.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length >= 2) tokens.add(tok);
      }
    }
    for (const token of tokens) {
      if (!index.byTopicToken.has(token)) index.byTopicToken.set(token, new Set());
      index.byTopicToken.get(token)!.add(source.id);
    }

    // byDomainTag
    for (const tag of source.domainTags) {
      const lower = tag.toLowerCase();
      if (!index.byDomainTag.has(lower)) index.byDomainTag.set(lower, new Set());
      index.byDomainTag.get(lower)!.add(source.id);
    }

    // byProvider
    if (!index.byProvider.has(source.provider)) index.byProvider.set(source.provider, new Set());
    index.byProvider.get(source.provider)!.add(source.id);

    // byAgent
    const agents = source.scope.agents || [];
    for (const agent of agents) {
      if (!index.byAgent.has(agent)) index.byAgent.set(agent, new Set());
      index.byAgent.get(agent)!.add(source.id);
    }
    // Global sources visible to all agents
    if (source.scope.visibility === "global") {
      for (const agentName of ALL_AGENT_NAMES) {
        if (!index.byAgent.has(agentName)) index.byAgent.set(agentName, new Set());
        index.byAgent.get(agentName)!.add(source.id);
      }
    }

    // byMethod
    if (source.tlsn_safe) index.byMethod.TLSN.add(source.id);
    if (source.dahr_safe) index.byMethod.DAHR.add(source.id);
  }

  return index;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAgentName(value: unknown): value is AgentName {
  return value === "sentinel" || value === "crawler" || value === "pioneer";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function hasValidScope(scope: unknown): scope is SourceRecordV2["scope"] {
  if (!isObjectRecord(scope)) return false;
  if (!SOURCE_VISIBILITIES.includes(scope.visibility as SourceRecordV2["scope"]["visibility"])) {
    return false;
  }
  if (!isStringArray(scope.importedFrom) || !scope.importedFrom.every(isAgentName)) return false;
  if (scope.visibility === "scoped") {
    return isStringArray(scope.agents) && scope.agents.every(isAgentName);
  }
  return scope.agents === undefined || (isStringArray(scope.agents) && scope.agents.every(isAgentName));
}

function hasValidRuntime(runtime: unknown): runtime is SourceRecordV2["runtime"] {
  if (!isObjectRecord(runtime) || typeof runtime.timeoutMs !== "number") return false;
  if (!isObjectRecord(runtime.retry)) return false;
  return (
    typeof runtime.retry.maxAttempts === "number" &&
    typeof runtime.retry.backoffMs === "number" &&
    Array.isArray(runtime.retry.retryOn) &&
    runtime.retry.retryOn.every((value) => RETRY_ON_VALUES.includes(value))
  );
}

function hasValidRating(rating: unknown): rating is SourceRecordV2["rating"] {
  if (!isObjectRecord(rating)) return false;
  return (
    typeof rating.overall === "number" &&
    typeof rating.uptime === "number" &&
    typeof rating.relevance === "number" &&
    typeof rating.freshness === "number" &&
    typeof rating.sizeStability === "number" &&
    typeof rating.engagement === "number" &&
    typeof rating.trust === "number" &&
    isOptionalString(rating.lastTestedAt) &&
    typeof rating.testCount === "number" &&
    typeof rating.successCount === "number" &&
    typeof rating.consecutiveFailures === "number"
  );
}

function hasValidLifecycle(lifecycle: unknown): lifecycle is SourceRecordV2["lifecycle"] {
  if (!isObjectRecord(lifecycle)) return false;
  return (
    typeof lifecycle.discoveredAt === "string" &&
    DISCOVERED_BY_VALUES.includes(lifecycle.discoveredBy as SourceRecordV2["lifecycle"]["discoveredBy"]) &&
    isOptionalString(lifecycle.promotedAt) &&
    isOptionalString(lifecycle.deprecatedAt) &&
    isOptionalString(lifecycle.archivedAt) &&
    isOptionalString(lifecycle.lastUsedAt) &&
    isOptionalString(lifecycle.lastFailedAt) &&
    isOptionalString(lifecycle.failureReason)
  );
}

function hasValidAdapter(adapter: unknown): adapter is SourceRecordV2["adapter"] {
  if (adapter === undefined) return true; // optional field
  if (!isObjectRecord(adapter)) return false;
  return typeof adapter.operation === "string";
}

export function isValidSourceRecord(record: unknown): record is SourceRecordV2 {
  if (!isObjectRecord(record)) return false;

  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.provider === "string" &&
    typeof record.url === "string" &&
    typeof record.urlPattern === "string" &&
    isOptionalStringArray(record.topics) &&
    (record.tlsn_safe === undefined || typeof record.tlsn_safe === "boolean") &&
    (record.dahr_safe === undefined || typeof record.dahr_safe === "boolean") &&
    isOptionalNumber(record.max_response_kb) &&
    isOptionalString(record.note) &&
    isOptionalStringArray(record.topicAliases) &&
    isStringArray(record.domainTags) &&
    RESPONSE_FORMATS.includes(record.responseFormat as SourceRecordV2["responseFormat"]) &&
    hasValidScope(record.scope) &&
    hasValidRuntime(record.runtime) &&
    hasValidAdapter(record.adapter) &&
    TRUST_TIERS.includes(record.trustTier as SourceRecordV2["trustTier"]) &&
    SOURCE_STATUSES.includes(record.status as SourceStatus) &&
    hasValidRating(record.rating) &&
    hasValidLifecycle(record.lifecycle)
  );
}

// ── Catalog Loading ─────────────────────────────────

/**
 * Load catalog.json from disk. Returns null if file doesn't exist or is invalid.
 */
export function loadCatalog(catalogPath: string): SourceCatalogFileV2 | null {
  try {
    const raw = readFileSync(catalogPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 2 || !Array.isArray(parsed?.sources)) return null;
    const totalCount = parsed.sources.length;
    const validSources = parsed.sources.filter((record: unknown, index: number) => {
      if (isValidSourceRecord(record)) return true;
      console.error(`Invalid catalog source record rejected at index ${index} in ${catalogPath}`);
      return false;
    });
    // If >50% of records were rejected, treat catalog as corrupt — return null
    // so catalog-preferred mode can fall back to YAML
    if (totalCount > 0 && validSources.length < totalCount * 0.5) {
      console.error(`Catalog ${catalogPath} rejected ${totalCount - validSources.length}/${totalCount} records — treating as invalid`);
      return null;
    }
    return {
      ...parsed,
      sources: validSources,
    } as SourceCatalogFileV2;
  } catch {
    return null;
  }
}

/**
 * Load a V1 YAML source registry. Returns empty array if file is missing/invalid.
 */
export function loadYamlRegistry(registryPath: string): SourceRecordV1[] {
  try {
    const parsed = parseYaml(readFileSync(registryPath, "utf-8")) as SourceRegistryV1;
    const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
    return sources.filter((s) => !!s?.name && !!s?.url);
  } catch {
    return [];
  }
}

/**
 * Load the default agent source config.
 * In the future, reads from agents/{name}/source-config.yaml.
 * For now, returns sensible defaults.
 */
function loadAgentSourceConfig(
  agent: AgentName,
  overrides?: Partial<AgentSourceConfig>
): AgentSourceConfig {
  const defaults: AgentSourceConfig = {
    agent,
    minRating: 0,
    allowStatuses: ["active", "degraded"],
    maxCandidatesPerTopic: 5,
  };
  return { ...defaults, ...overrides };
}

/**
 * Load an agent's source view — filtered, indexed sources ready for runtime use.
 *
 * Resolution order (by SourceRegistryMode):
 *   - catalog-preferred: catalog.json if valid, else YAML fallback
 *   - catalog-only: catalog.json required
 *   - yaml-only: YAML registry only (legacy)
 *
 * @param agent - Agent name
 * @param catalogPath - Path to catalog.json
 * @param yamlRegistryPath - Path to agent's sources-registry.yaml (for fallback)
 * @param mode - Registry mode
 * @param configOverrides - Optional runtime overrides for agent source config
 */
export function loadAgentSourceView(
  agent: AgentName,
  catalogPath: string,
  yamlRegistryPath: string,
  mode: SourceRegistryMode = "catalog-preferred",
  configOverrides?: Partial<AgentSourceConfig>
): AgentSourceView {
  const config = loadAgentSourceConfig(agent, configOverrides);

  // Try catalog first
  if (mode === "catalog-preferred" || mode === "catalog-only") {
    const catalog = loadCatalog(catalogPath);
    if (catalog) {
      // Filter by agent visibility, status, and rating
      const filtered = catalog.sources.filter((s) => {
        // Agent visibility check
        if (s.scope.visibility === "scoped") {
          if (!s.scope.agents?.includes(agent)) return false;
        }
        // Status check
        if (!config.allowStatuses.includes(s.status)) return false;
        // Rating check
        if (s.rating.overall < config.minRating) return false;
        return true;
      });

      return {
        agent,
        catalogVersion: 2,
        sources: filtered,
        index: buildSourceIndex(filtered),
      };
    }

    if (mode === "catalog-only") {
      // No catalog and catalog-only mode — return empty
      return {
        agent,
        catalogVersion: 2,
        sources: [],
        index: buildSourceIndex([]),
      };
    }
    // Fall through to YAML
  }

  // YAML fallback (or yaml-only mode)
  const v1Records = loadYamlRegistry(yamlRegistryPath);
  const now = new Date().toISOString();
  const v2Records = v1Records.map((r) => normalizeSourceRecord(r, agent, now));

  return {
    agent,
    catalogVersion: 1,
    sources: v2Records,
    index: buildSourceIndex(v2Records),
  };
}
