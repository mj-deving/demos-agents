/**
 * Declarative provider adapter engine — loads YAML specs and creates
 * ProviderAdapter instances from them at runtime.
 *
 * This is the core scaling mechanism: adding a new provider is typically
 * just adding a YAML spec file rather than writing ~250 lines of TypeScript.
 *
 * The engine implements the full ProviderAdapter contract:
 *   - buildCandidates: resolve variables, build URLs, inject auth
 *   - validateCandidate: enforce TLSN/DAHR constraints, rewrite queries
 *   - parseResponse: JSON paths, regex blocks, templates, field mapping
 *
 * Never throws from any adapter method — returns empty results on failure.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SourceRecordV2 } from "../catalog.js";
import type {
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  CandidateValidation,
  FetchedResponse,
  ParsedAdapterResponse,
  EvidenceEntry,
  AttestationMethod,
  SurgicalCandidate,
} from "./types.js";
import type { ExtractedClaim } from "../../claim-extraction.js";

// ── Spec Types ──────────────────────────────────────

export interface DeclarativeProviderSpec {
  schemaVersion: 1;
  provider: ProviderSpecMeta;
  operations: Record<string, OperationSpec>;
}

export interface ProviderSpecMeta {
  name: string;
  displayName: string;
  matches: {
    providers: string[];
    hosts?: string[];
    urlPatterns?: string[];
  };
  domains: string[];
  rateLimit: {
    bucket: string;
    maxPerMinute?: number;
    maxPerDay?: number;
    byOperation?: Record<string, { bucket?: string; maxPerMinute?: number; maxPerDay?: number }>;
  };
  auth: {
    mode: "none" | "query-param-env" | "header-env";
    envVar?: string;
    queryParam?: string;
    headerName?: string;
    headerValueTemplate?: string;
  };
  defaults: {
    responseFormat: string;
    parseFailureMode?: "empty-entries" | "single-raw-entry";
    normalizeJson?: boolean;
  };
}

export interface VariableSpec {
  sources: Array<string | { literal: string }>;
  required?: boolean;
  default?: string;
  transforms?: Array<string | { map: Record<string, string> } | { "regex-replace": { pattern: string; replacement: string } }>;
  enum?: string[];
  pattern?: string;
}

export interface FieldSpec {
  jsonPath?: string;
  regex?: string;
  template?: string;
  required?: boolean;
  default?: unknown;
  transforms?: Array<string | { truncate: number }>;
}

export interface RewriteQueryRule {
  default?: number;
  max?: number;
}

export interface CompatibilitySpec {
  responseFormats?: string[];
  tlsn?: {
    allowed?: boolean;
    requireHttps?: boolean;
    maxResponseKb?: number;
    rewriteQuery?: Record<string, RewriteQueryRule>;
    requireQuery?: Record<string, string>;
  };
  dahr?: {
    allowed?: boolean;
    requireNormalizedJson?: boolean;
    blockedReason?: string | null;
  };
}

export interface ParseSpec {
  format: "json" | "xml" | "rss";
  envelope?: {
    jsonPath?: string;
  };
  items: {
    mode: "json-path" | "regex-blocks" | "single-object" | "array-tuples" | "object-entries";
    jsonPath?: string;
    blockPattern?: string;
    tupleFields?: string[];
  };
  fields: Record<string, FieldSpec | Record<string, FieldSpec>>;
  hooks?: {
    module?: string | null;
    resolveVariables?: string | null;
    validateCandidate?: string | null;
    postParse?: string | null;
  };
}

export interface OperationSpec {
  when: {
    sourceAdapterOperation?: string[];
    urlPatterns?: string[];
    default?: boolean;
  };
  request: {
    method: "GET";
    urlTemplate: string;
    query?: Record<string, string | number | boolean>;
    headers?: Record<string, string>;
    estimatedSizeKb?: Record<string, number>;
    matchHints?: string[];
  };
  variables?: Record<string, VariableSpec>;
  compatibility?: CompatibilitySpec;
  parse: ParseSpec;
  /** Claim types this operation can verify (e.g., ["price", "metric"]) */
  claimTypes?: string[];
  /** JSONPath to extract the verifiable value; supports {var} interpolation */
  extractionPath?: string;
}

// ── Hook Module Interface ───────────────────────────

export interface DeclarativeHookModule {
  resolveVariables?: (
    input: BuildCandidatesContext,
    operation: OperationSpec,
    resolved: Record<string, string>,
  ) => Record<string, string>;
  validateCandidate?: (
    candidate: CandidateRequest,
    operation: OperationSpec,
  ) => CandidateValidation | null;
  postParse?: (
    source: SourceRecordV2,
    response: FetchedResponse,
    parsedRoot: unknown,
    entries: EvidenceEntry[],
  ) => ParsedAdapterResponse;
}

// ── Engine Options ──────────────────────────────────

export interface DeclarativeEngineOptions {
  specDir: string;
  strictValidation?: boolean;
}

// ── Minimal JSONPath ────────────────────────────────

/**
 * Minimal JSONPath implementation supporting:
 *   $            → root
 *   $.field      → obj.field
 *   $.a.b        → obj.a.b
 *   $.arr[*]     → iterate array
 *   $[1]         → index access
 *   $[1][*]      → index then iterate
 *
 * No filters, no recursion, no deep descent. Deliberately minimal.
 * Returns undefined for missing paths; returns an array for [*] paths.
 */
function jsonPathGet(obj: unknown, path: string): unknown {
  if (path === "$" || !path) return obj;

  // Remove leading $
  let rest = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;

  let current: unknown = obj;

  while (rest.length > 0) {
    if (current == null) return undefined;

    // Handle [N] or [*] at the start of remaining path
    const bracketMatch = rest.match(/^\[(\d+|\*)\]/);
    if (bracketMatch) {
      const idx = bracketMatch[1];
      rest = rest.slice(bracketMatch[0].length);

      // Strip leading dot after bracket
      if (rest.startsWith(".")) rest = rest.slice(1);

      if (idx === "*") {
        // Collect all items — if remaining path exists, map through it
        if (!Array.isArray(current)) return [];
        if (rest.length === 0) return current;
        return current.map((item) => jsonPathGet(item, "$." + rest)).flat();
      } else {
        const arrIdx = Number(idx);
        if (Array.isArray(current)) {
          current = current[arrIdx];
        } else {
          return undefined;
        }
      }
      continue;
    }

    // Handle dot-separated field
    const dotIdx = rest.indexOf(".");
    const bracketIdx = rest.indexOf("[");

    let field: string;
    if (dotIdx === -1 && bracketIdx === -1) {
      // Last segment
      field = rest;
      rest = "";
    } else if (bracketIdx !== -1 && (dotIdx === -1 || bracketIdx < dotIdx)) {
      // Bracket comes before dot
      field = rest.slice(0, bracketIdx);
      rest = rest.slice(bracketIdx);
    } else {
      // Dot comes first
      field = rest.slice(0, dotIdx);
      rest = rest.slice(dotIdx + 1);
    }

    if (field && typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[field];
    } else if (field) {
      return undefined;
    }
  }

  return current;
}

// ── Variable Resolution ─────────────────────────────

/**
 * Resolve a single variable from its spec, pulling values from
 * the build context in priority order defined by sources.
 */
function resolveVariable(
  varSpec: VariableSpec,
  ctx: BuildCandidatesContext,
): string | undefined {
  let value: string | undefined;

  for (const source of varSpec.sources) {
    if (typeof source === "object" && "literal" in source) {
      value = source.literal;
      break;
    }

    const sourceStr = source as string;

    if (sourceStr === "topic") {
      if (ctx.topic) { value = ctx.topic; break; }
    } else if (sourceStr.startsWith("vars.")) {
      const key = sourceStr.slice(5);
      if (ctx.vars[key] != null && ctx.vars[key] !== "") { value = ctx.vars[key]; break; }
    } else if (sourceStr.startsWith("tokens[")) {
      const idxMatch = sourceStr.match(/^tokens\[(\d+)\]$/);
      if (idxMatch) {
        const idx = Number(idxMatch[1]);
        if (ctx.tokens[idx]) { value = ctx.tokens[idx]; break; }
      }
    }
  }

  // Apply default if no source matched
  if ((value == null || value === "") && varSpec.default != null) {
    value = varSpec.default;
  }

  // Apply transforms
  if (value != null && varSpec.transforms) {
    value = applyTransforms(value, varSpec.transforms);
  }

  // Validate against enum
  if (value != null && varSpec.enum && !varSpec.enum.includes(value)) {
    return undefined;
  }

  // Validate against pattern
  if (value != null && varSpec.pattern) {
    try {
      if (!new RegExp(varSpec.pattern).test(value)) return undefined;
    } catch {
      // Bad regex — skip validation
    }
  }

  return value;
}

/**
 * Apply a chain of transforms to a string value.
 */
function applyTransforms(
  value: string,
  transforms: Array<string | { map: Record<string, string> } | { "regex-replace": { pattern: string; replacement: string } }>,
): string {
  let result = value;

  for (const t of transforms) {
    if (typeof t === "string") {
      switch (t) {
        case "trim": result = result.trim(); break;
        case "lowercase": result = result.toLowerCase(); break;
        case "uppercase": result = result.toUpperCase(); break;
        case "slug": result = result.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); break;
        case "wiki-title": result = result.replace(/\s+/g, "_"); break;
      }
    } else if ("map" in t) {
      const mapped = t.map[result.toLowerCase()];
      if (mapped != null) result = mapped;
    } else if ("regex-replace" in t) {
      try {
        result = result.replace(new RegExp(t["regex-replace"].pattern, "g"), t["regex-replace"].replacement);
      } catch {
        // Bad regex — skip
      }
    }
  }

  return result;
}

/**
 * Resolve all variables for an operation, respecting required flags.
 * Returns null if any required variable cannot be resolved.
 */
function resolveAllVariables(
  operation: OperationSpec,
  ctx: BuildCandidatesContext,
): Record<string, string> | null {
  const resolved: Record<string, string> = {};

  if (!operation.variables) return resolved;

  for (const [name, spec] of Object.entries(operation.variables)) {
    const value = resolveVariable(spec, ctx);
    if (value != null) {
      resolved[name] = value;
    } else if (spec.required) {
      return null; // Required variable unresolved — no candidates
    }
  }

  return resolved;
}

// ── URL Building ────────────────────────────────────

/**
 * Interpolate {varName} placeholders in a string using resolved variables
 * and context. Also handles {topic}, {tokens[N]}, {source.id}.
 */
function interpolate(
  template: string,
  vars: Record<string, string>,
  ctx?: BuildCandidatesContext,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    // Direct variable lookup
    if (vars[key] != null) return vars[key];

    // Context-based lookups
    if (ctx) {
      if (key === "topic") return ctx.topic || "";
      if (key.startsWith("tokens[")) {
        const idxMatch = key.match(/^tokens\[(\d+)\]$/);
        if (idxMatch) return ctx.tokens[Number(idxMatch[1])] || "";
      }
      if (key === "source.id") return ctx.source.id;
    }

    return match; // Unresolved — leave as-is
  });
}

/**
 * Build a fully resolved URL from an operation's template, query params,
 * and auth settings.
 */
function buildUrl(
  operation: OperationSpec,
  spec: DeclarativeProviderSpec,
  vars: Record<string, string>,
  ctx: BuildCandidatesContext,
): string {
  // Interpolate URL template
  let url = interpolate(operation.request.urlTemplate, vars, ctx);

  // Build query parameters
  const queryEntries: [string, string][] = [];
  if (operation.request.query) {
    for (const [key, val] of Object.entries(operation.request.query)) {
      const resolved = interpolate(String(val), vars, ctx);
      queryEntries.push([key, resolved]);
    }
  }

  // Inject auth
  const auth = spec.provider.auth;
  if (auth.mode === "query-param-env" && auth.envVar && auth.queryParam) {
    const envVal = process.env[auth.envVar];
    if (envVal) {
      queryEntries.push([auth.queryParam, envVal]);
    }
  }

  // Build final URL with query params
  if (queryEntries.length > 0) {
    const urlObj = new URL(url);
    for (const [k, v] of queryEntries) {
      urlObj.searchParams.set(k, v);
    }
    url = urlObj.toString();
  }

  return url;
}

// ── Operation Resolution ────────────────────────────

/**
 * Find the matching operation for a source record within a spec.
 * Priority: exact adapter.operation match > URL pattern match > default.
 */
function resolveOperation(
  spec: DeclarativeProviderSpec,
  source: SourceRecordV2,
): [string, OperationSpec] | null {
  const adapterOp = source.adapter?.operation;

  // 1. Exact adapter.operation match
  if (adapterOp) {
    for (const [name, op] of Object.entries(spec.operations)) {
      if (op.when.sourceAdapterOperation?.includes(adapterOp)) {
        return [name, op];
      }
    }
  }

  // 2. URL pattern match
  for (const [name, op] of Object.entries(spec.operations)) {
    if (op.when.urlPatterns) {
      for (const pattern of op.when.urlPatterns) {
        try {
          if (new RegExp(pattern).test(source.url)) {
            return [name, op];
          }
        } catch {
          // Bad regex — skip
        }
      }
    }
  }

  // 3. Default operation
  for (const [name, op] of Object.entries(spec.operations)) {
    if (op.when.default) return [name, op];
  }

  return null;
}

// ── Attestation Checks ──────────────────────────────

/**
 * Check if an attestation method is allowed for an operation.
 */
function isAttestationAllowed(
  compat: CompatibilitySpec | undefined,
  attestation: AttestationMethod,
): boolean {
  if (!compat) return true;
  if (attestation === "TLSN") return compat.tlsn?.allowed !== false;
  if (attestation === "DAHR") return compat.dahr?.allowed !== false;
  return true;
}

// ── Response Parsing ────────────────────────────────

/**
 * Extract a field value from an item using the field spec.
 * Supports jsonPath, regex, and template modes.
 */
function extractField(
  item: unknown,
  fieldSpec: FieldSpec,
  vars: Record<string, string>,
  key?: string,
  parsedRoot?: unknown,
): unknown {
  let value: unknown;

  if (fieldSpec.jsonPath) {
    value = jsonPathGet(item, fieldSpec.jsonPath);
  } else if (fieldSpec.regex && typeof item === "string") {
    try {
      const match = item.match(new RegExp(fieldSpec.regex));
      value = match?.[1] ?? undefined;
    } catch {
      value = undefined;
    }
  } else if (fieldSpec.template) {
    value = resolveTemplate(fieldSpec.template, item, vars, key);
  }

  // Apply default
  if (value == null && fieldSpec.default !== undefined) {
    value = fieldSpec.default;
  }

  // Apply transforms
  if (value != null && fieldSpec.transforms) {
    value = applyFieldTransforms(value, fieldSpec.transforms);
  }

  return value;
}

/**
 * Resolve a template string with fallback chains.
 * Template format: "{field1|field2|(fallback literal)}"
 * Also supports simple interpolation: "prefix {field} suffix"
 *
 * Special tokens:
 *   {key}  — the object-entries key (for object-entries parse mode)
 *   {.}    — self-reference: the item itself when it's a primitive (string/number)
 *            Example: item="38001" → {.} resolves to "38001"
 *            Used by pubmed esearch where idlist contains bare strings.
 *   {(literal)} — literal fallback text in parentheses
 */
/**
 * Resolve a dotted/bracketed path against an object.
 * Supports: "field", "a.b", "a[0]", "a.b[1].c", "c[0]"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  // Split on dots and brackets: "a.b[0].c" → ["a", "b", "0", "c"]
  const segments = path.split(/\.|\[(\d+)\]/).filter((s) => s !== "" && s !== undefined);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    if (/^\d+$/.test(seg)) {
      // Array index
      current = Array.isArray(current) ? current[Number(seg)] : (current as Record<string, unknown>)[seg];
    } else {
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}

function resolveTemplate(
  template: string,
  item: unknown,
  vars: Record<string, string>,
  key?: string,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, expr: string) => {
    // Check for fallback chain (pipe-separated)
    const parts = expr.split("|");

    for (const part of parts) {
      const trimmed = part.trim();

      // Literal fallback in parentheses
      if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
        return trimmed.slice(1, -1);
      }

      // Special key reference for object-entries mode
      if (trimmed === "key" && key != null) return key;

      // Self-reference for primitive items (e.g., {.} when item is "38001")
      if (trimmed === "." && item != null && typeof item !== "object") {
        return String(item);
      }

      // Variable lookup
      if (vars[trimmed] != null) return vars[trimmed];

      // Item field lookup — supports dotted paths and bracket notation
      // e.g., {description.en}, {c[0]}, {country.value}, {v[1]}
      if (typeof item === "object" && item !== null) {
        const val = getNestedValue(item, trimmed);
        if (val != null) return String(val);
      }
    }

    return "";
  });
}

/**
 * Apply field-level transforms (currently just truncate).
 */
function applyFieldTransforms(
  value: unknown,
  transforms: Array<string | { truncate: number }>,
): unknown {
  let result = value;

  for (const t of transforms) {
    if (typeof t === "object" && "truncate" in t) {
      if (typeof result === "string" && result.length > t.truncate) {
        result = result.slice(0, t.truncate);
      }
    }
  }

  return result;
}

/**
 * Extract items from a parsed response body according to the parse spec.
 */
function extractItems(
  parsed: unknown,
  parseSpec: ParseSpec,
  responseText: string,
): Array<{ item: unknown; key?: string }> {
  const items: Array<{ item: unknown; key?: string }> = [];

  // Apply envelope unwrap first
  let root = parsed;
  if (parseSpec.envelope?.jsonPath && root != null) {
    root = jsonPathGet(root, parseSpec.envelope.jsonPath);
  }

  switch (parseSpec.items.mode) {
    case "json-path": {
      if (!parseSpec.items.jsonPath) break;
      const result = jsonPathGet(root, parseSpec.items.jsonPath);
      if (Array.isArray(result)) {
        for (const item of result) items.push({ item });
      } else if (result != null) {
        items.push({ item: result });
      }
      break;
    }

    case "regex-blocks": {
      if (!parseSpec.items.blockPattern) break;
      try {
        const regex = new RegExp(parseSpec.items.blockPattern, "g");
        let match: RegExpExecArray | null;
        while ((match = regex.exec(responseText)) !== null) {
          // Use the captured group (or full match) as the item text
          items.push({ item: match[1] ?? match[0] });
        }
      } catch {
        // Bad regex — return empty
      }
      break;
    }

    case "single-object": {
      if (root != null) items.push({ item: root });
      break;
    }

    case "array-tuples": {
      if (!Array.isArray(root) || !parseSpec.items.tupleFields) break;
      for (const tuple of root) {
        if (!Array.isArray(tuple)) continue;
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < parseSpec.items.tupleFields.length; i++) {
          obj[parseSpec.items.tupleFields[i]] = tuple[i];
        }
        items.push({ item: obj });
      }
      break;
    }

    case "object-entries": {
      // Navigate to target object via jsonPath if specified
      let target = root;
      if (parseSpec.items.jsonPath && parseSpec.items.jsonPath !== "$") {
        target = jsonPathGet(root, parseSpec.items.jsonPath);
      }
      if (typeof target !== "object" || target === null || Array.isArray(target)) break;
      for (const [key, val] of Object.entries(target)) {
        // Skip non-object values (e.g., pubmed's "uids" array in result)
        if (val == null || typeof val !== "object" || Array.isArray(val)) continue;
        items.push({ item: val, key });
      }
      break;
    }
  }

  return items;
}

/**
 * Map an extracted item to an EvidenceEntry using field specs.
 * Returns null if required fields (id) are missing.
 */
function mapItemToEntry(
  item: unknown,
  key: string | undefined,
  fields: Record<string, FieldSpec | Record<string, FieldSpec>>,
  vars: Record<string, string>,
  rawMode: string | undefined,
  parsedRoot: unknown,
): EvidenceEntry | null {
  const get = (name: string): unknown => {
    const spec = fields[name];
    if (!spec || typeof spec !== "object") return undefined;

    // Check if it's a FieldSpec (has jsonPath, regex, template, required, default, or transforms)
    if ("jsonPath" in spec || "regex" in spec || "template" in spec || "required" in spec || "default" in spec || "mode" in spec) {
      return extractField(item, spec as FieldSpec, vars, key, parsedRoot);
    }
    return undefined;
  };

  // Extract id — required
  const id = get("id");
  if (id == null || id === "") return null;

  // Extract standard fields
  const title = get("title");
  const summary = get("summary");
  const bodyText = get("bodyText");
  const canonicalUrl = get("canonicalUrl");
  const publishedAt = get("publishedAt");

  // Extract topics — may be array from jsonPath or comma-separated from template
  let topics: string[] = [];
  const topicsSpec = fields.topics;
  if (topicsSpec && typeof topicsSpec === "object") {
    const topicsVal = extractField(item, topicsSpec as FieldSpec, vars, key, parsedRoot);
    if (Array.isArray(topicsVal)) {
      topics = topicsVal.filter((t): t is string => typeof t === "string");
    } else if (typeof topicsVal === "string") {
      topics = topicsVal.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  // Extract metrics — nested field specs
  let metrics: Record<string, string | number> | undefined;
  const metricsSpec = fields.metrics;
  if (metricsSpec && typeof metricsSpec === "object" && !("jsonPath" in metricsSpec) && !("template" in metricsSpec)) {
    metrics = {};
    for (const [mKey, mSpec] of Object.entries(metricsSpec)) {
      if (typeof mSpec === "object" && mSpec !== null) {
        const mVal = extractField(item, mSpec as FieldSpec, vars, key, parsedRoot);
        if (mVal != null) {
          metrics[mKey] = typeof mVal === "number" ? mVal : String(mVal);
        }
      }
    }
  }

  // Determine raw value
  let raw: unknown;
  const rawSpec = fields.raw;
  if (rawSpec && typeof rawSpec === "object" && "mode" in rawSpec) {
    switch ((rawSpec as { mode: string }).mode) {
      case "item": raw = item; break;
      case "matched-block": raw = item; break;
      case "parsed-root": raw = parsedRoot; break;
      default: raw = item;
    }
  } else {
    raw = item;
  }

  return {
    id: String(id),
    title: title != null ? String(title) : undefined,
    summary: summary != null ? String(summary) : undefined,
    bodyText: bodyText != null ? String(bodyText) : String(title ?? "(no content)"),
    canonicalUrl: canonicalUrl != null ? String(canonicalUrl) : undefined,
    publishedAt: publishedAt != null ? String(publishedAt) : undefined,
    topics,
    metrics,
    raw,
  };
}

// ── Query Rewriting ─────────────────────────────────

/**
 * Apply rewriteQuery rules to a URL — enforce max values on query params.
 */
function applyRewriteQuery(
  url: string,
  rules: Record<string, RewriteQueryRule>,
): { url: string; rewritten: boolean } {
  try {
    const parsed = new URL(url);
    let rewritten = false;

    for (const [param, rule] of Object.entries(rules)) {
      const current = parsed.searchParams.get(param);

      if (current !== null && rule.max != null) {
        const num = Number(current);
        if (!isNaN(num) && num > rule.max) {
          parsed.searchParams.set(param, String(rule.max));
          rewritten = true;
        }
      } else if (current === null && rule.default != null) {
        parsed.searchParams.set(param, String(rule.default));
        rewritten = true;
      }
    }

    return { url: rewritten ? parsed.toString() : url, rewritten };
  } catch {
    return { url, rewritten: false };
  }
}

/**
 * Apply requireQuery rules — force certain query params to specific values.
 */
function applyRequireQuery(
  url: string,
  rules: Record<string, string>,
): string {
  try {
    const parsed = new URL(url);
    for (const [param, value] of Object.entries(rules)) {
      parsed.searchParams.set(param, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// ── Hook Loading ────────────────────────────────────

/** Cache for loaded hook modules */
const hookCache = new Map<string, DeclarativeHookModule>();

/**
 * Load a hook module (sync for startup, cached after first load).
 * Returns null if no module path or load fails.
 */
async function loadHookModule(
  modulePath: string | null | undefined,
  specDir: string,
): Promise<DeclarativeHookModule | null> {
  if (!modulePath) return null;

  const cacheKey = resolve(specDir, modulePath);
  if (hookCache.has(cacheKey)) return hookCache.get(cacheKey)!;

  try {
    // Resolve relative to specDir parent (specs/ is inside providers/)
    const fullPath = resolve(dirname(specDir), modulePath);
    const mod = await import(fullPath);
    const hookModule: DeclarativeHookModule = {
      resolveVariables: typeof mod.resolveVariables === "function" ? mod.resolveVariables : undefined,
      validateCandidate: typeof mod.validateCandidate === "function" ? mod.validateCandidate : undefined,
      postParse: typeof mod.postParse === "function" ? mod.postParse : undefined,
    };
    hookCache.set(cacheKey, hookModule);
    return hookModule;
  } catch {
    return null;
  }
}

// ── Adapter Factory ─────────────────────────────────

/**
 * Create a ProviderAdapter from a declarative spec.
 * This is the core factory — one spec produces one adapter instance.
 */
function createAdapterFromSpec(
  spec: DeclarativeProviderSpec,
  hooks: Map<string, DeclarativeHookModule>,
): ProviderAdapter {
  const providerName = spec.provider.name;

  return {
    provider: providerName,
    domains: spec.provider.domains,
    rateLimit: {
      bucket: spec.provider.rateLimit.bucket,
      maxPerMinute: spec.provider.rateLimit.maxPerMinute,
      maxPerDay: spec.provider.rateLimit.maxPerDay,
    },

    supports(source: SourceRecordV2): boolean {
      // Check provider name match
      if (spec.provider.matches.providers.includes(source.provider)) return true;

      // Check host match
      if (spec.provider.matches.hosts) {
        try {
          const host = new URL(source.url).hostname;
          if (spec.provider.matches.hosts.includes(host)) return true;
        } catch {
          // Bad URL — no match
        }
      }

      // Check URL pattern match
      if (spec.provider.matches.urlPatterns) {
        for (const pattern of spec.provider.matches.urlPatterns) {
          try {
            if (new RegExp(pattern).test(source.url)) return true;
          } catch {
            // Bad regex — skip
          }
        }
      }

      return false;
    },

    buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
      try {
        // Resolve operation
        const opResult = resolveOperation(spec, ctx.source);
        if (!opResult) return [];
        const [opName, operation] = opResult;

        // Check attestation compatibility
        if (!isAttestationAllowed(operation.compatibility, ctx.attestation)) return [];

        // Resolve variables
        let resolved = resolveAllVariables(operation, ctx);
        if (resolved === null) return []; // Required variable unresolved

        // Apply hook resolveVariables
        const hookModule = findHookForOperation(operation, hooks);
        if (hookModule?.resolveVariables) {
          resolved = hookModule.resolveVariables(ctx, operation, resolved);
        }

        // Apply TLSN rewriteQuery during build to set safe defaults
        let url = buildUrl(operation, spec, resolved, ctx);

        if (ctx.attestation === "TLSN" && operation.compatibility?.tlsn?.rewriteQuery) {
          const result = applyRewriteQuery(url, operation.compatibility.tlsn.rewriteQuery);
          url = result.url;
        }

        // Apply requireQuery
        if (ctx.attestation === "TLSN" && operation.compatibility?.tlsn?.requireQuery) {
          url = applyRequireQuery(url, operation.compatibility.tlsn.requireQuery);
        }

        // Check HTTPS requirement
        if (ctx.attestation === "TLSN" && operation.compatibility?.tlsn?.requireHttps) {
          if (!url.startsWith("https://")) return [];
        }

        // Build match hints
        const matchHints: string[] = [];
        if (operation.request.matchHints) {
          for (const hint of operation.request.matchHints) {
            const resolvedHint = interpolate(hint, resolved, ctx);
            if (resolvedHint && !resolvedHint.includes("{")) {
              matchHints.push(resolvedHint);
            }
          }
        }

        // Estimated size
        const sizeKey = ctx.attestation;
        const estimatedSizeKb = operation.request.estimatedSizeKb?.[sizeKey];

        const candidate: CandidateRequest = {
          sourceId: ctx.source.id,
          provider: providerName,
          operation: opName,
          method: "GET" as const,
          url,
          attestation: ctx.attestation,
          estimatedSizeKb,
          matchHints,
        };

        return [candidate].slice(0, ctx.maxCandidates);
      } catch {
        return [];
      }
    },

    validateCandidate(candidate: CandidateRequest): CandidateValidation {
      try {
        // Find the operation
        const operation = spec.operations[candidate.operation];
        if (!operation) return { ok: true };

        const compat = operation.compatibility;
        if (!compat) return { ok: true };

        // Check attestation allowed
        if (candidate.attestation === "TLSN" && compat.tlsn?.allowed === false) {
          return { ok: false, reason: "TLSN not allowed for this operation" };
        }
        if (candidate.attestation === "DAHR" && compat.dahr?.allowed === false) {
          return {
            ok: false,
            reason: compat.dahr?.blockedReason || "DAHR not allowed for this operation",
          };
        }

        // Enforce maxResponseKb for TLSN
        if (candidate.attestation === "TLSN" && compat.tlsn) {
          const maxKb = compat.tlsn.maxResponseKb ?? 16;
          if (candidate.estimatedSizeKb && candidate.estimatedSizeKb > maxKb) {
            return { ok: false, reason: `Estimated response ${candidate.estimatedSizeKb}KB exceeds TLSN limit ${maxKb}KB` };
          }
        }

        // Enforce requireNormalizedJson for DAHR
        if (candidate.attestation === "DAHR" && compat.dahr?.requireNormalizedJson) {
          const parseFormat = operation.parse?.format;
          if (parseFormat && parseFormat !== "json") {
            return { ok: false, reason: `DAHR requires JSON but operation parse format is ${parseFormat}` };
          }
        }

        // Enforce responseFormats compatibility
        if (compat.responseFormats && compat.responseFormats.length > 0) {
          // Check against source responseFormat if we can infer it from the operation
          const parseFormat = operation.parse?.format;
          if (parseFormat && !compat.responseFormats.includes(parseFormat)) {
            return { ok: false, reason: `Parse format ${parseFormat} not in allowed responseFormats` };
          }
        }

        let url = candidate.url;
        let rewritten = false;

        // Enforce HTTPS for TLSN
        if (candidate.attestation === "TLSN" && compat.tlsn?.requireHttps) {
          if (!url.startsWith("https://")) {
            return { ok: false, reason: "TLSN requires HTTPS" };
          }
        }

        // Apply rewriteQuery rules
        if (candidate.attestation === "TLSN" && compat.tlsn?.rewriteQuery) {
          const result = applyRewriteQuery(url, compat.tlsn.rewriteQuery);
          if (result.rewritten) {
            url = result.url;
            rewritten = true;
          }
        }

        // Apply requireQuery rules
        if (candidate.attestation === "TLSN" && compat.tlsn?.requireQuery) {
          const newUrl = applyRequireQuery(url, compat.tlsn.requireQuery);
          if (newUrl !== url) {
            url = newUrl;
            rewritten = true;
          }
        }

        // Apply hook validateCandidate
        const hookModule = findHookForOperation(operation, hooks);
        if (hookModule?.validateCandidate) {
          const hookResult = hookModule.validateCandidate(candidate, operation);
          if (hookResult) return hookResult;
        }

        if (rewritten) {
          return { ok: true, reason: "Query parameters rewritten for safety", rewrittenUrl: url };
        }

        return { ok: true };
      } catch {
        return { ok: true };
      }
    },

    parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
      try {
        // Find operation
        const opResult = resolveOperation(spec, source);
        if (!opResult) return { entries: [] };
        const [, operation] = opResult;

        const parseSpec = operation.parse;
        let parsed: unknown = null;
        let entries: EvidenceEntry[] = [];

        // Parse the body based on format
        if (parseSpec.format === "json") {
          try {
            parsed = JSON.parse(response.bodyText);
          } catch {
            return { entries: [], normalized: null };
          }
        }
        // For XML/regex mode, the raw text is the item source
        // parsed stays null — regex extraction uses response.bodyText

        // Extract items
        const extractedItems = extractItems(parsed, parseSpec, response.bodyText);

        // Build resolved vars for template interpolation in fields
        // Use empty context vars — parseResponse doesn't have BuildCandidatesContext
        const templateVars: Record<string, string> = {};

        // Map items to entries
        for (const { item, key } of extractedItems) {
          const entry = mapItemToEntry(
            item,
            key,
            parseSpec.fields,
            templateVars,
            undefined,
            parsed,
          );
          if (entry) entries.push(entry);
        }

        // Apply hook postParse
        const hookModule = findHookForOperation(operation, hooks);
        if (hookModule?.postParse) {
          const hookResult = hookModule.postParse(source, response, parsed, entries);
          if (hookResult) return hookResult;
        }

        // Determine normalized output for DAHR
        const normalized = parseSpec.format === "json" && spec.provider.defaults.normalizeJson
          ? parsed
          : undefined;

        return { entries, normalized };
      } catch {
        return { entries: [] };
      }
    },

    buildSurgicalUrl(claim: ExtractedClaim, source: SourceRecordV2): SurgicalCandidate | null {
      try {
        // Find operations that declare claimTypes matching this claim
        for (const [opName, operation] of Object.entries(spec.operations)) {
          if (!operation.claimTypes || !operation.claimTypes.includes(claim.type)) continue;
          if (!operation.extractionPath) continue;

          // Build a synthetic context from claim entities
          const entity = claim.entities[0] || "";
          const syntheticCtx: BuildCandidatesContext = {
            source,
            topic: entity,
            tokens: claim.entities,
            vars: { asset: entity, symbol: entity },
            attestation: "DAHR", // default; caller upgrades to TLSN if appropriate
            maxCandidates: 1,
          };

          // Resolve variables using existing engine logic
          const resolved = resolveAllVariables(operation, syntheticCtx);
          if (resolved === null) continue;

          // Build URL using existing engine logic
          const url = buildUrl(operation, spec, resolved, syntheticCtx);

          // Interpolate extractionPath with resolved variables
          const extractionPath = interpolate(operation.extractionPath, resolved, syntheticCtx);

          // Estimate size (prefer TLSN estimate, fall back to DAHR)
          const sizeKb = operation.request.estimatedSizeKb?.TLSN
            ?? operation.request.estimatedSizeKb?.DAHR
            ?? 16;
          const estimatedSizeBytes = sizeKb * 1024;

          // Resolve rate limit bucket (per-operation override or provider default)
          const rateLimitBucket = spec.provider.rateLimit.byOperation?.[opName]?.bucket
            || spec.provider.rateLimit.bucket;

          return {
            claim,
            url,
            estimatedSizeBytes,
            method: "GET",
            extractionPath,
            provider: providerName,
            rateLimitBucket,
          };
        }

        return null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Find the hook module for an operation, checking parse.hooks.module path.
 */
function findHookForOperation(
  operation: OperationSpec,
  hooks: Map<string, DeclarativeHookModule>,
): DeclarativeHookModule | null {
  const modulePath = operation.parse.hooks?.module;
  if (!modulePath) return null;
  return hooks.get(modulePath) ?? null;
}

// ── Public API ──────────────────────────────────────

/**
 * Load all declarative provider specs from a directory and create
 * ProviderAdapter instances from them.
 *
 * Scans for *.yaml and *.json files in specDir.
 * Returns a Map of provider name to adapter.
 * Logs and skips invalid specs in non-strict mode.
 * Throws on invalid specs in strict mode.
 */
export async function loadDeclarativeProviderAdapters(
  options: DeclarativeEngineOptions,
): Promise<Map<string, ProviderAdapter>> {
  const { specDir, strictValidation = false } = options;
  const adapters = new Map<string, ProviderAdapter>();

  // Scan for spec files
  let files: string[];
  try {
    files = readdirSync(specDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"),
    );
  } catch {
    if (strictValidation) {
      throw new Error(`Cannot read spec directory: ${specDir}`);
    }
    return adapters;
  }

  // Collect all hook module paths for pre-loading
  const hookModules = new Map<string, DeclarativeHookModule>();
  const specs: DeclarativeProviderSpec[] = [];

  for (const file of files) {
    const filePath = join(specDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const spec = parseYaml(content) as DeclarativeProviderSpec;

      // Basic validation
      if (!spec || spec.schemaVersion !== 1) {
        if (strictValidation) throw new Error(`Invalid schemaVersion in ${file}`);
        continue;
      }
      if (!spec.provider?.name) {
        if (strictValidation) throw new Error(`Missing provider.name in ${file}`);
        continue;
      }
      if (!spec.operations || Object.keys(spec.operations).length === 0) {
        if (strictValidation) throw new Error(`No operations defined in ${file}`);
        continue;
      }

      // Check for duplicate provider names
      if (adapters.has(spec.provider.name)) {
        if (strictValidation) {
          throw new Error(`Duplicate provider name "${spec.provider.name}" in ${file}`);
        }
        continue;
      }

      // Collect hook modules
      for (const op of Object.values(spec.operations)) {
        const hookPath = op.parse?.hooks?.module;
        if (hookPath && !hookModules.has(hookPath)) {
          const loaded = await loadHookModule(hookPath, specDir);
          if (loaded) hookModules.set(hookPath, loaded);
        }
      }

      specs.push(spec);
    } catch (err) {
      if (strictValidation) throw err;
      // Non-strict: silently skip bad spec
    }
  }

  // Create adapters from valid specs
  for (const spec of specs) {
    const adapter = createAdapterFromSpec(spec, hookModules);
    adapters.set(spec.provider.name, adapter);
  }

  return adapters;
}

/**
 * Synchronous variant of loadDeclarativeProviderAdapters for environments
 * that cannot use async (e.g., module-level initialization).
 * Does not support hook modules — hooks will be null.
 */
export function loadDeclarativeProviderAdaptersSync(
  options: DeclarativeEngineOptions,
): Map<string, ProviderAdapter> {
  const { specDir, strictValidation = false } = options;
  const adapters = new Map<string, ProviderAdapter>();

  let files: string[];
  try {
    files = readdirSync(specDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"),
    );
  } catch {
    if (strictValidation) {
      throw new Error(`Cannot read spec directory: ${specDir}`);
    }
    return adapters;
  }

  const emptyHooks = new Map<string, DeclarativeHookModule>();

  for (const file of files) {
    const filePath = join(specDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const spec = parseYaml(content) as DeclarativeProviderSpec;

      if (!spec || spec.schemaVersion !== 1) {
        if (strictValidation) throw new Error(`Invalid schemaVersion in ${file}`);
        continue;
      }
      if (!spec.provider?.name) {
        if (strictValidation) throw new Error(`Missing provider.name in ${file}`);
        continue;
      }
      if (!spec.operations || Object.keys(spec.operations).length === 0) {
        if (strictValidation) throw new Error(`No operations defined in ${file}`);
        continue;
      }
      if (adapters.has(spec.provider.name)) {
        if (strictValidation) throw new Error(`Duplicate provider name "${spec.provider.name}"`);
        continue;
      }

      const adapter = createAdapterFromSpec(spec, emptyHooks);
      adapters.set(spec.provider.name, adapter);
    } catch (err) {
      if (strictValidation) throw err;
    }
  }

  return adapters;
}

// ── Exports for Testing ─────────────────────────────

export { jsonPathGet as _jsonPathGet };
export { resolveVariable as _resolveVariable };
export { interpolate as _interpolate };
export { resolveOperation as _resolveOperation };
export { applyRewriteQuery as _applyRewriteQuery };
export { extractItems as _extractItems };
export { mapItemToEntry as _mapItemToEntry };
