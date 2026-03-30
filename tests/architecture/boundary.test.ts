/**
 * Architecture boundary enforcement — ADR-0002 compliance.
 *
 * Ensures src/toolkit/ never imports from strategy code (src/lib/, src/plugins/,
 * src/actions/, cli/). Also validates deprecated re-export shims only forward
 * to toolkit paths and contain no logic.
 *
 * See: docs/decisions/0002-toolkit-vs-strategy-boundary.md
 * See: docs/decisions/0014-architecture-enforcement-layers.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const TOOLKIT_DIR = join(ROOT, "src/toolkit");
const SHIM_DIRS = [
  join(ROOT, "src/lib/util"),
  join(ROOT, "src/lib/sources"),
  join(ROOT, "src/lib/sources/providers"),
  join(ROOT, "src/lib/network"),
  join(ROOT, "src/reactive"),
];

// ── Helpers ──────────────────────────────────────

function findTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

interface ImportEntry {
  path: string;
  typeOnly: boolean;
}

function extractImportPaths(source: string): ImportEntry[] {
  const entries: ImportEntry[] = [];
  const re = /(?:import|export)\s+(type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    entries.push({ path: match[2], typeOnly: !!match[1] });
  }
  const sideEffect = /^import\s+["']([^"']+)["']/gm;
  while ((match = sideEffect.exec(source)) !== null) {
    entries.push({ path: match[1], typeOnly: false });
  }
  // Dynamic import() — always runtime
  const dynamicRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicRe.exec(source)) !== null) {
    entries.push({ path: match[1], typeOnly: false });
  }
  return entries;
}

const FORBIDDEN_PREFIXES = [
  "../../lib/",
  "../lib/",
  "../../plugins/",
  "../plugins/",
  "../../actions/",
  "../actions/",
  "../../../cli/",
  "../../cli/",
];

function isForbiddenImport(importPath: string): boolean {
  if (!importPath.startsWith(".")) return false;
  return FORBIDDEN_PREFIXES.some((prefix) => importPath.startsWith(prefix));
}

/** Pre-parsed file data — computed once, shared across all tests. */
interface ParsedFile {
  rel: string;
  imports: ImportEntry[];
}

function parseToolkitFiles(files: string[]): ParsedFile[] {
  return files.map((file) => ({
    rel: relative(ROOT, file),
    imports: extractImportPaths(readFileSync(file, "utf8")),
  }));
}

/** Check a boundary rule across all toolkit files. */
function checkBoundary(
  parsed: ParsedFile[],
  predicate: (imp: ImportEntry) => boolean,
): string[] {
  const violations: string[] = [];
  for (const { rel, imports } of parsed) {
    for (const imp of imports) {
      if (predicate(imp)) {
        violations.push(`  ${rel} imports "${imp.path}"`);
      }
    }
  }
  return violations;
}

function formatViolations(label: string, violations: string[]): string {
  if (violations.length === 0) return "";
  const inner = `  ARCHITECTURE BOUNDARY VIOLATION: ${label}  `;
  const width = Math.max(inner.length, 40);
  return [
    "",
    `╔${"═".repeat(width)}╗`,
    `║${inner.padEnd(width)}║`,
    `╚${"═".repeat(width)}╝`,
    "",
    ...violations,
    "",
    `${violations.length} violation(s). See docs/decisions/0002-toolkit-vs-strategy-boundary.md`,
    "",
  ].join("\n");
}

// ── Pre-compute (read files once) ────────────────

const toolkitFiles = findTsFiles(TOOLKIT_DIR);
const parsed = parseToolkitFiles(toolkitFiles);

interface ShimFile {
  rel: string;
  source: string;
  imports: ImportEntry[];
}

function findShimFiles(): ShimFile[] {
  const results: ShimFile[] = [];
  for (const dir of SHIM_DIRS) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      const full = join(dir, entry.name);
      const source = readFileSync(full, "utf8");
      if (source.includes("@deprecated")) {
        results.push({
          rel: relative(ROOT, full),
          source,
          imports: extractImportPaths(source),
        });
      }
    }
  }
  return results;
}

const shims = findShimFiles();

// ── Tests ────────────────────────────────────────

// Known runtime exceptions — re-export shims within toolkit that forward from src/lib/.
// Each entry must reference the plan that resolves it.
const KNOWN_RUNTIME_EXCEPTIONS = [
  // scoring.ts re-exports constants — resolves when scoring moves to toolkit
  "src/toolkit/supercolony/scoring.ts",
  // health.ts dynamic import of legacy provider adapter — resolves when providers fully move to toolkit
  "src/toolkit/sources/health.ts",
  // connect.ts dynamic import of auth — resolves when auth redesigned with injected apiFetch (Phase 4)
  "src/toolkit/tools/connect.ts",
];

describe("Architecture Boundary — ADR-0002", () => {
  it("should find toolkit files to scan", () => {
    expect(toolkitFiles.length).toBeGreaterThan(30);
  });

  it("toolkit must not have runtime imports from src/lib/", () => {
    const violations = checkBoundary(parsed, (imp) =>
      isForbiddenImport(imp.path) && !imp.typeOnly
    );

    const unexpected = violations.filter(
      (v) => !KNOWN_RUNTIME_EXCEPTIONS.some((exc) => v.includes(exc))
    );

    expect(unexpected, formatViolations("toolkit → strategy (runtime)", unexpected)).toHaveLength(0);
  });

  it("toolkit type-only imports from src/lib/ are tracked", () => {
    const typeImports = checkBoundary(parsed, (imp) =>
      isForbiddenImport(imp.path) && imp.typeOnly
    );

    // If this cap grows, investigate — it may indicate new coupling.
    expect(typeImports.length).toBeLessThanOrEqual(3);
  });

  it("toolkit must not import from src/plugins/", () => {
    const violations = checkBoundary(parsed, (imp) =>
      !imp.typeOnly && (imp.path.includes("/plugins/") || imp.path.startsWith("../plugins"))
    );
    expect(violations, formatViolations("toolkit → plugins", violations)).toHaveLength(0);
  });

  it("toolkit must not import from src/actions/", () => {
    const violations = checkBoundary(parsed, (imp) =>
      !imp.typeOnly && (imp.path.includes("/actions/") || imp.path.startsWith("../actions"))
    );
    expect(violations, formatViolations("toolkit → actions", violations)).toHaveLength(0);
  });

  it("toolkit must not import from cli/", () => {
    const violations = checkBoundary(parsed, (imp) =>
      !imp.typeOnly && imp.path.includes("/cli/")
    );
    expect(violations, formatViolations("toolkit → cli", violations)).toHaveLength(0);
  });
});

describe("Deprecated Shim Validation — ADR-0002", () => {
  it("should find deprecated shim files", () => {
    expect(shims.length).toBeGreaterThan(5);
  });

  it("deprecated shims must only re-export from toolkit paths", () => {
    const violations: string[] = [];
    for (const { rel, imports } of shims) {
      for (const imp of imports) {
        if (!imp.path.includes("/toolkit/") && !imp.path.includes("@demos-agents/core")) {
          violations.push(`  ${rel} imports "${imp.path}" (expected toolkit path)`);
        }
      }
    }
    expect(violations, formatViolations("shim → non-toolkit", violations)).toHaveLength(0);
  });

  it("deprecated shims must not contain logic beyond re-exports", () => {
    const violations: string[] = [];
    for (const { rel, source } of shims) {
      // A shim should only have export/import statements, no other code.
      // Count statements that aren't export/import — robust against any comment style.
      const statements = source.split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*") && !l.startsWith("*/") && !l.startsWith("/**"))
        .filter((l) => !l.startsWith("export ") && !l.startsWith("import "));

      if (statements.length > 0) {
        violations.push(`  ${rel} has non-export statements: ${statements[0]}`);
      }
    }
    expect(violations, formatViolations("shim contains logic", violations)).toHaveLength(0);
  });
});
