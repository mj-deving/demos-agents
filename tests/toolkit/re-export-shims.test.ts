import { describe, expect, expectTypeOf, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DeclarativeProviderSpec as CoreDeclarativeProviderSpec } from "@demos-agents/core";
import type { ProviderAdapter as CoreProviderAdapter } from "@demos-agents/core";
import type { DeclarativeProviderSpec as ToolkitDeclarativeProviderSpec } from "../../src/toolkit/providers/declarative-engine.js";
import type { ProviderAdapter as ToolkitProviderAdapter } from "../../src/toolkit/providers/types.js";
import type { ProviderAdapter as LegacyProviderAdapter } from "../../src/lib/sources/providers/types.js";

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
  {
    oldPath: "../../src/lib/sources/providers/declarative-engine.js",
    newPath: "../../src/toolkit/providers/declarative-engine.js",
  },
  {
    oldPath: "../../src/reactive/event-loop.js",
    newPath: "../../src/toolkit/reactive/event-loop.js",
  },
  {
    oldPath: "../../src/reactive/watermark-store.js",
    newPath: "../../src/toolkit/reactive/watermark-store.js",
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
  "src/toolkit/providers/declarative-engine.ts",
  "src/toolkit/providers/types.ts",
  "src/toolkit/reactive/event-loop.ts",
  "src/toolkit/reactive/watermark-store.ts",
  "src/toolkit/math/baseline.ts",
  "src/toolkit/chain/tx-pipeline.ts",
] as const;

const FORBIDDEN_IMPORT_PATTERNS = [
  /\.\.\/lib\/state\.js/,
  /\.\.\/lib\/agent-config\.js/,
  /\.\.\/lib\/attestation\/attestation-policy\.js/,
  /src\/lib\/state\.js/,
  /src\/lib\/agent-config\.js/,
  /src\/lib\/attestation\/attestation-policy\.js/,
  /from ["'][^"']*\/state\.js["']/,
  /from ["'][^"']*\/agent-config\.js["']/,
  /from ["'][^"']*\/attestation-policy\.js["']/,
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

  it("keeps providers/types working through the legacy shim", async () => {
    const legacyModule = await import("../../src/lib/sources/providers/types.js");
    const toolkitModule = await import("../../src/toolkit/providers/types.js");

    expect(Object.keys(legacyModule).sort()).toEqual(Object.keys(toolkitModule).sort());
    expectTypeOf<LegacyProviderAdapter>().toEqualTypeOf<ToolkitProviderAdapter>();
  });

  it("exposes the moved Step 8 surface from the toolkit barrel and core package", async () => {
    const toolkit = await import("../../src/toolkit/index.js");
    const core = await import("@demos-agents/core");
    const declarativeEngine = await import("../../src/toolkit/providers/declarative-engine.js");

    expect(toolkit.loadDeclarativeProviderAdapters).toBe(
      declarativeEngine.loadDeclarativeProviderAdapters
    );
    expect(toolkit.loadDeclarativeProviderAdaptersSync).toBe(
      declarativeEngine.loadDeclarativeProviderAdaptersSync
    );
    expect(core.loadDeclarativeProviderAdapters).toBe(toolkit.loadDeclarativeProviderAdapters);
    expect(core.loadDeclarativeProviderAdaptersSync).toBe(toolkit.loadDeclarativeProviderAdaptersSync);

    expectTypeOf<CoreProviderAdapter>().toEqualTypeOf<ToolkitProviderAdapter>();
    expectTypeOf<CoreDeclarativeProviderSpec>().toEqualTypeOf<ToolkitDeclarativeProviderSpec>();
  });

  it("exposes Phase 3 reactive and chain primitives from the toolkit barrel and core package", async () => {
    const toolkit = await import("../../src/toolkit/index.js");
    const core = await import("@demos-agents/core");
    const reactive = await import("../../src/toolkit/reactive/event-loop.js");
    const watermarks = await import("../../src/toolkit/reactive/watermark-store.js");
    const chain = await import("../../src/toolkit/chain/tx-pipeline.js");

    expect(toolkit.startEventLoop).toBe(reactive.startEventLoop);
    expect(toolkit.nextInterval).toBe(reactive.nextInterval);
    expect(toolkit.createFileWatermarkStore).toBe(watermarks.createFileWatermarkStore);
    expect(toolkit.createMemoryWatermarkStore).toBe(watermarks.createMemoryWatermarkStore);
    expect(toolkit.executeChainTx).toBe(chain.executeChainTx);

    expect(core.startEventLoop).toBe(toolkit.startEventLoop);
    expect(core.executeChainTx).toBe(toolkit.executeChainTx);
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
