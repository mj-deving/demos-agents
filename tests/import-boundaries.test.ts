/**
 * Import boundary lint rules — enforced via vitest.
 *
 * Validates that module boundaries are respected:
 * - core/ never imports from platform/ or agents/
 * - platform/ never imports from agents/
 * - connectors/ is the only bridge to @kynesyslabs/demosdk
 *
 * These rules ensure the codebase remains modular and the core
 * can be extracted as a standalone package (Phase 5).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function getImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const imports: string[] = [];
  // Match both import and export statements
  const regex = /(?:import|export)\s+.*?from\s+["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  // Also match dynamic imports
  const dynamicRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

describe("import boundaries — core/ isolation", () => {
  const coreFile = resolve(ROOT, "core/index.ts");

  it("core/index.ts does not import from platform/", () => {
    const imports = getImports(coreFile);
    const platformImports = imports.filter(
      (imp) => imp.includes("/platform/") || imp.startsWith("../platform")
    );
    expect(platformImports).toEqual([]);
  });

  it("core/index.ts does not import from agents/", () => {
    const imports = getImports(coreFile);
    const agentImports = imports.filter(
      (imp) => imp.includes("/agents/") || imp.startsWith("../agents")
    );
    expect(agentImports).toEqual([]);
  });

  it("core/index.ts does not import @kynesyslabs/demosdk", () => {
    const imports = getImports(coreFile);
    const sdkImports = imports.filter((imp) => imp.includes("kynesyslabs"));
    expect(sdkImports).toEqual([]);
  });
});

describe("import boundaries — platform/ isolation", () => {
  const platformFile = resolve(ROOT, "platform/index.ts");

  it("platform/index.ts does not import from agents/", () => {
    const imports = getImports(platformFile);
    const agentImports = imports.filter(
      (imp) => imp.includes("/agents/") || imp.startsWith("../agents")
    );
    expect(agentImports).toEqual([]);
  });
});

describe("import boundaries — core modules have no SDK dependency", () => {
  // Check the actual source files that core re-exports
  const coreSourceFiles = [
    "tools/lib/sources/providers/declarative-engine.ts",
    "tools/lib/sources/lifecycle.ts",
    "tools/lib/sources/catalog.ts",
    "tools/lib/sources/fetch.ts",
    "tools/lib/sources/rate-limit.ts",
    "tools/lib/sources/health.ts",
    "tools/lib/sources/matcher.ts",
    "tools/lib/observe.ts",
    "tools/lib/log.ts",
    "tools/lib/subprocess.ts",
    "tools/lib/agent-config.ts",
  ];

  for (const relPath of coreSourceFiles) {
    it(`${relPath} does not import @kynesyslabs/demosdk directly`, () => {
      const filePath = resolve(ROOT, relPath);
      const imports = getImports(filePath);
      const sdkImports = imports.filter((imp) => imp.includes("kynesyslabs"));
      expect(sdkImports, `${relPath} has direct SDK import: ${sdkImports.join(", ")}`).toEqual([]);
    });
  }
});

describe("import boundaries — packages/core/ has zero SuperColony imports", () => {
  const corePackageFiles = readdirSync(resolve(ROOT, "packages/core"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `packages/core/${f}`);

  for (const relPath of corePackageFiles) {
    it(`${relPath} has no supercolony/demos/hive references`, () => {
      const content = readFileSync(resolve(ROOT, relPath), "utf-8");
      const forbidden = ["supercolony", "demosdk", "kynesyslabs", "HIVE"];
      for (const term of forbidden) {
        expect(
          content.toLowerCase().includes(term.toLowerCase()),
          `${relPath} contains "${term}"`
        ).toBe(false);
      }
    });
  }
});

describe("import boundaries — connectors/ isolates SDK", () => {
  const connectorsFile = resolve(ROOT, "connectors/index.ts");

  it("connectors/index.ts imports @kynesyslabs/demosdk", () => {
    const imports = getImports(connectorsFile);
    const sdkImports = imports.filter((imp) => imp.includes("kynesyslabs"));
    expect(sdkImports.length).toBeGreaterThan(0);
  });
});
