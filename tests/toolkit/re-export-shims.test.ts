import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

const SHIM_CASES = [
  {
    oldPath: "../../src/lib/sources/catalog.js",
    newPath: "../../src/toolkit/sources/catalog.js",
  },
  {
    oldPath: "../../src/lib/sources/fetch.js",
    newPath: "../../src/toolkit/sources/fetch.js",
  },
  {
    oldPath: "../../src/lib/sources/health.js",
    newPath: "../../src/toolkit/sources/health.js",
  },
  {
    oldPath: "../../src/lib/sources/rate-limit.js",
    newPath: "../../src/toolkit/sources/rate-limit.js",
  },
  {
    oldPath: "../../src/lib/sources/providers/generic.js",
    newPath: "../../src/toolkit/providers/generic.js",
  },
  {
    oldPath: "../../src/lib/util/errors.js",
    newPath: "../../src/toolkit/util/errors.js",
  },
  {
    oldPath: "../../src/lib/network/fetch-with-timeout.js",
    newPath: "../../src/toolkit/network/fetch-with-timeout.js",
  },
  {
    oldPath: "../../src/lib/network/storage-client.js",
    newPath: "../../src/toolkit/network/storage-client.js",
  },
] as const;

const TOOLKIT_FILES = [
  "src/toolkit/sources/catalog.ts",
  "src/toolkit/sources/fetch.ts",
  "src/toolkit/sources/health.ts",
  "src/toolkit/sources/rate-limit.ts",
  "src/toolkit/providers/generic.ts",
  "src/toolkit/util/errors.ts",
  "src/toolkit/network/fetch-with-timeout.ts",
  "src/toolkit/network/storage-client.ts",
] as const;

const FORBIDDEN_IMPORT_PATTERNS = [
  /\.\.\/lib\/state\.js/,
  /\.\.\/lib\/agent-config\.js/,
  /src\/lib\/state\.js/,
  /src\/lib\/agent-config\.js/,
  /from ["'][^"']*\/state\.js["']/,
  /from ["'][^"']*\/agent-config\.js["']/,
] as const;

describe("Phase 2 re-export shims", () => {
  it.each(SHIM_CASES)("keeps %s working via a shim", async ({ oldPath, newPath }) => {
    const oldModule = await import(oldPath);
    const newModule = await import(newPath);

    expect(Object.keys(oldModule).sort()).toEqual(Object.keys(newModule).sort());

    for (const key of Object.keys(newModule)) {
      expect(oldModule[key as keyof typeof oldModule]).toBe(newModule[key as keyof typeof newModule]);
    }
  });

  it("exposes the moved Step 4 surface from the toolkit barrel", async () => {
    const toolkit = await import("../../src/toolkit/index.js");
    const core = await import("@demos-agents/core");
    const catalog = await import("../../src/toolkit/sources/catalog.js");
    const fetchModule = await import("../../src/toolkit/sources/fetch.js");
    const health = await import("../../src/toolkit/sources/health.js");
    const rateLimit = await import("../../src/toolkit/sources/rate-limit.js");
    const generic = await import("../../src/toolkit/providers/generic.js");

    expect(toolkit.loadCatalog).toBe(catalog.loadCatalog);
    expect(toolkit.fetchSource).toBe(fetchModule.fetchSource);
    expect(toolkit.testSource).toBe(health.testSource);
    expect(toolkit.acquireRateLimitToken).toBe(rateLimit.acquireRateLimitToken);
    expect(toolkit.genericProviderAdapter).toBe(generic.adapter);

    expect(core.loadCatalog).toBe(toolkit.loadCatalog);
    expect(core.fetchSource).toBe(toolkit.fetchSource);
    expect(core.testSource).toBe(toolkit.testSource);
  });

  it("exposes the moved Step 5 surface from the toolkit barrel", async () => {
    const toolkit = await import("../../src/toolkit/index.js");
    const errors = await import("../../src/toolkit/util/errors.js");

    expect(toolkit.toErrorMessage).toBe(errors.toErrorMessage);
  });

  it("exposes the moved Step 6 surface from the toolkit barrel", async () => {
    const toolkit = await import("../../src/toolkit/index.js");
    const core = await import("@demos-agents/core");
    const networkFetch = await import("../../src/toolkit/network/fetch-with-timeout.js");
    const storage = await import("../../src/toolkit/network/storage-client.js");

    expect(toolkit.fetchWithTimeout).toBe(networkFetch.fetchWithTimeout);
    expect(toolkit.createStorageClient).toBe(storage.createStorageClient);
    expect(core.fetchWithTimeout).toBe(toolkit.fetchWithTimeout);
    expect(core.createStorageClient).toBe(toolkit.createStorageClient);
  });
});

describe("Phase 2 toolkit import boundaries", () => {
  it.each(TOOLKIT_FILES)("%s stays out of strategy-only modules", (relativePath) => {
    const filePath = resolve(ROOT, relativePath);
    expect(existsSync(filePath), `${relativePath} should exist after the move`).toBe(true);

    const source = readFileSync(filePath, "utf-8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
  });
});
