#!/usr/bin/env npx tsx
/**
 * Spec-Catalog Consistency Checker
 *
 * Verifies that declarative YAML provider specs match their catalog.json entries.
 * Catches variable name mismatches, query parameter differences, and host misalignment.
 *
 * Usage:
 *   npx tsx tools/spec-consistency.ts --pretty
 *   npx tsx tools/spec-consistency.ts --json
 *   npx tsx tools/spec-consistency.ts --provider etherscan --pretty
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = resolve(__dirname, "lib/sources/providers/specs");
const CATALOG_PATH = resolve(__dirname, "../sources/catalog.json");

// ── Arg Parsing ──────────────────────────────────────

const args = process.argv.slice(2);
const pretty = args.includes("--pretty");
const jsonOutput = args.includes("--json");
const providerFilter = (() => {
  const idx = args.indexOf("--provider");
  return idx >= 0 ? args[idx + 1] : undefined;
})();

// ── Types ──────────────────────────────────────

interface Issue {
  source: string;
  provider: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
}

// ── Load Data ──────────────────────────────────────

const catalogRaw = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));
const catalogSources: any[] = Array.isArray(catalogRaw)
  ? catalogRaw
  : catalogRaw.sources || [];

// Load all specs
const specFiles = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".yaml"));
const specs = new Map<string, any>();

for (const file of specFiles) {
  const content = readFileSync(join(SPECS_DIR, file), "utf-8");
  const spec = parseYaml(content);
  if (spec?.provider?.name) {
    specs.set(spec.provider.name, spec);
  }
}

// ── Comparison Logic ──────────────────────────────────────

/** Extract variable names from a URL template like {symbol}, {query} */
function extractVars(url: string): Set<string> {
  const vars = new Set<string>();
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(url)) !== null) {
    vars.add(m[1].toLowerCase());
  }
  return vars;
}

/** Parse query params from a URL */
function parseQueryParams(url: string): Map<string, string> {
  const params = new Map<string, string>();
  const qIdx = url.indexOf("?");
  if (qIdx < 0) return params;
  const qs = url.slice(qIdx + 1);
  for (const pair of qs.split("&")) {
    const [key, val] = pair.split("=");
    if (key) params.set(decodeURIComponent(key), decodeURIComponent(val || ""));
  }
  return params;
}

/** Extract host from URL */
function extractHost(url: string): string {
  try {
    // Handle template URLs by replacing vars temporarily
    const cleaned = url.replace(/\{[^}]+\}/g, "PLACEHOLDER");
    return new URL(cleaned).hostname;
  } catch {
    return "";
  }
}

const issues: Issue[] = [];

for (const source of catalogSources) {
  if (source.status !== "active") continue;
  if (source.provider === "generic") continue;
  if (providerFilter && source.provider !== providerFilter) continue;

  const spec = specs.get(source.provider);
  if (!spec) {
    issues.push({
      source: source.name || source.id,
      provider: source.provider,
      severity: "HIGH",
      message: `No spec file found for provider "${source.provider}"`,
    });
    continue;
  }

  const catalogUrl = source.url || "";
  const catalogHost = extractHost(catalogUrl);
  const catalogVars = extractVars(catalogUrl);
  const catalogParams = parseQueryParams(catalogUrl);

  // Find matching operation in spec — score each operation, pick best match
  const ops = spec.operations || {};
  let matchedOp: any = null;
  let matchedOpName = "";
  let bestScore = 0; // Minimum score of 1 required to match (prevents false-negative on unknown URLs)

  const urlPath = catalogUrl.replace(/https?:\/\/[^/]+/, "").split("?")[0];

  for (const [opName, op] of Object.entries(ops) as [string, any][]) {
    if (!op?.request?.urlTemplate) continue;
    let score = 0;

    // URL pattern match (highest signal)
    const patterns = op.when?.urlPatterns || [];
    if (patterns.some((p: string) => new RegExp(p).test(catalogUrl))) {
      score += 10;
    }

    // Path match (after stripping vars and query)
    const specPath = (op.request.urlTemplate || "").replace(/https?:\/\/[^/]+/, "").split("?")[0];
    if (specPath && urlPath && specPath.replace(/\{[^}]+\}/g, "") === urlPath.replace(/\{[^}]+\}/g, "")) {
      score += 5;
    }

    // Query param overlap (helps distinguish etherscan ops sharing /api path)
    // Check both urlTemplate params and request.query params
    const specParams = parseQueryParams(op.request.urlTemplate || "");
    const requestQuery = op.request?.query || {};
    for (const [k, v] of Object.entries(requestQuery)) {
      if (typeof v === "string" && !v.includes("{")) {
        specParams.set(k, v);
      }
    }
    for (const [key, val] of catalogParams) {
      if (val.includes("{")) continue;
      const specVal = specParams.get(key);
      if (specVal && !specVal.includes("{") && specVal === val) {
        score += 3; // Exact param match
      }
    }

    // Default operation gets a small boost
    if (op.when?.default) score += 1;

    if (score > bestScore) {
      bestScore = score;
      matchedOp = op;
      matchedOpName = opName;
    }
  }

  if (!matchedOp) {
    issues.push({
      source: source.name || source.id,
      provider: source.provider,
      severity: "MEDIUM",
      message: `No matching operation found in spec for catalog URL`,
    });
    continue;
  }

  const specUrl = matchedOp.request.urlTemplate || "";
  const specVars = extractVars(specUrl);
  const specParams = parseQueryParams(specUrl);

  // Build set of resolved variable names from spec (includes vars.X sources)
  const resolvedSpecVars = new Set(specVars);
  const opVars = matchedOp.variables || {};
  for (const [varName, varDef] of Object.entries(opVars) as [string, any][]) {
    const sources = varDef?.sources || [];
    for (const src of sources) {
      if (typeof src === "string" && src.startsWith("vars.")) {
        resolvedSpecVars.add(src.replace("vars.", "").toLowerCase());
      }
    }
  }

  // Check variable name mismatches
  for (const catalogVar of catalogVars) {
    // Skip if the spec resolves this var through its variable sources chain
    if (resolvedSpecVars.has(catalogVar)) continue;

    if (!specVars.has(catalogVar)) {
      // Check if spec has a similar var (e.g., symbols vs symbol)
      const similar = [...specVars].find(
        (v) => v.startsWith(catalogVar) || catalogVar.startsWith(v)
      );
      if (similar) {
        // Check if the similar var resolves the catalog var through sources
        const similarDef = opVars[similar];
        const similarSources = (similarDef?.sources || []).map((s: string) =>
          typeof s === "string" ? s.replace("vars.", "").toLowerCase() : ""
        );
        if (similarSources.includes(catalogVar)) continue; // Resolved via variable chain

        issues.push({
          source: source.name || source.id,
          provider: source.provider,
          severity: "HIGH",
          message: `Variable mismatch: catalog uses {${catalogVar}} but spec op "${matchedOpName}" uses {${similar}}`,
        });
      }
    }
  }

  // Check query parameter differences (ignoring template vars)
  for (const [key, catalogVal] of catalogParams) {
    if (catalogVal.includes("{")) continue; // Skip template vars
    const specVal = specParams.get(key);
    if (specVal && !specVal.includes("{") && specVal !== catalogVal) {
      issues.push({
        source: source.name || source.id,
        provider: source.provider,
        severity: "MEDIUM",
        message: `Query param "${key}" differs: catalog="${catalogVal}" vs spec="${specVal}" (op: ${matchedOpName})`,
      });
    }
  }

  // Check host matches
  const specHost = extractHost(specUrl);
  if (catalogHost && specHost && catalogHost !== specHost) {
    issues.push({
      source: source.name || source.id,
      provider: source.provider,
      severity: "HIGH",
      message: `Host mismatch: catalog="${catalogHost}" vs spec="${specHost}"`,
    });
  }
}

// ── Output ──────────────────────────────────────

if (jsonOutput) {
  console.log(JSON.stringify({ issues, total: issues.length }, null, 2));
} else if (pretty) {
  if (issues.length === 0) {
    console.log("✓ All catalog sources are consistent with their provider specs.");
  } else {
    console.log(`\n  Spec-Catalog Consistency: ${issues.length} issue(s) found\n`);
    for (const issue of issues) {
      const icon = issue.severity === "HIGH" ? "✗" : issue.severity === "MEDIUM" ? "⚠" : "○";
      console.log(`  ${icon} [${issue.severity}] ${issue.source} (${issue.provider})`);
      console.log(`    ${issue.message}\n`);
    }
  }
} else {
  for (const issue of issues) {
    console.log(`[${issue.severity}] ${issue.source}: ${issue.message}`);
  }
}

process.exit(issues.filter((i) => i.severity === "HIGH").length > 0 ? 1 : 0);
