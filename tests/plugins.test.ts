/**
 * Plugin system tests — validates all 7 FrameworkPlugin implementations.
 *
 * Covers:
 * - Interface compliance (name, version present on all plugins)
 * - Registry integration (register, get, getAll, getHooks)
 * - Sources plugin hook existence and type
 * - Plugin name uniqueness
 * - init() lifecycle
 */

import { describe, it, expect } from "vitest";
import type { FrameworkPlugin } from "../core/types.js";
import type { AgentConfig } from "../tools/lib/agent-config.js";
import { createPluginRegistry } from "../core/types.js";
import {
  createSourcesPlugin,
  createLifecyclePlugin,
  createSignalsPlugin,
  createPredictionsPlugin,
  createTipsPlugin,
  createCalibratePlugin,
  createObservePlugin,
} from "../core/plugins/index.js";

/** All plugin factories for iteration */
const factories: Array<[string, () => FrameworkPlugin]> = [
  ["sources", createSourcesPlugin],
  ["lifecycle", createLifecyclePlugin],
  ["signals", createSignalsPlugin],
  ["predictions", createPredictionsPlugin],
  ["tips", createTipsPlugin],
  ["calibrate", createCalibratePlugin],
  ["observe", createObservePlugin],
];

describe("FrameworkPlugin implementations", () => {
  // Test 1: All 7 plugins implement FrameworkPlugin interface
  it.each(factories)(
    "%s plugin has name and version",
    (_label, factory) => {
      const plugin = factory();
      expect(typeof plugin.name).toBe("string");
      expect(plugin.name.length).toBeGreaterThan(0);
      expect(typeof plugin.version).toBe("string");
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );

  // Test 2: createPluginRegistry registers all 7 plugins successfully
  it("registers all 7 plugins without error", () => {
    const registry = createPluginRegistry();
    for (const [, factory] of factories) {
      expect(() => registry.register(factory())).not.toThrow();
    }
    expect(registry.getAll()).toHaveLength(7);
  });

  // Test 3: getAll() returns all 7 plugins
  it("getAll() returns all 7 plugins", () => {
    const registry = createPluginRegistry();
    for (const [, factory] of factories) {
      registry.register(factory());
    }
    const all = registry.getAll();
    expect(all).toHaveLength(7);
    const names = all.map((p) => p.name);
    expect(names).toContain("sources");
    expect(names).toContain("lifecycle");
    expect(names).toContain("signals");
    expect(names).toContain("predictions");
    expect(names).toContain("tips");
    expect(names).toContain("calibrate");
    expect(names).toContain("observe");
  });

  // Test 4: get("sources") returns the sources plugin
  it('get("sources") returns the sources plugin', () => {
    const registry = createPluginRegistry();
    for (const [, factory] of factories) {
      registry.register(factory());
    }
    const sources = registry.get("sources");
    expect(sources).toBeDefined();
    expect(sources!.name).toBe("sources");
  });

  // Test 5: getHooks("beforePublishDraft") returns sources plugin hook
  it('getHooks("beforePublishDraft") includes sources hook', () => {
    const registry = createPluginRegistry();
    for (const [, factory] of factories) {
      registry.register(factory());
    }
    const hooks = registry.getHooks("beforePublishDraft");
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    expect(typeof hooks[0]).toBe("function");
  });

  // Test 6: getHooks("nonexistent") returns empty array
  it('getHooks("nonexistent") returns empty array', () => {
    const registry = createPluginRegistry();
    for (const [, factory] of factories) {
      registry.register(factory());
    }
    const hooks = registry.getHooks("nonexistent");
    expect(hooks).toEqual([]);
  });

  // Test 7: SourcesPlugin beforePublishDraft hook exists and is a function
  it("sources plugin has beforePublishDraft hook as function", () => {
    const plugin = createSourcesPlugin();
    expect(plugin.hooks).toBeDefined();
    expect(typeof plugin.hooks!.beforePublishDraft).toBe("function");
  });

  // Test 8: SourcesPlugin afterPublishDraft hook exists and is a function
  it("sources plugin has afterPublishDraft hook as function", () => {
    const plugin = createSourcesPlugin();
    expect(plugin.hooks).toBeDefined();
    expect(typeof plugin.hooks!.afterPublishDraft).toBe("function");
  });

  // Test 9: Plugin init() can be called (mock config)
  it("plugin init() can be called with mock config", async () => {
    const plugin = createSourcesPlugin();
    if (plugin.init) {
      // Should not throw with a minimal mock config
      const mockConfig = { name: "test-agent" } as AgentConfig;
      await expect(plugin.init(mockConfig)).resolves.not.toThrow();
    }
  });

  // Test 10: Plugin names are unique across all 7
  it("all plugin names are unique", () => {
    const names = factories.map(([, factory]) => factory().name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(unique.size).toBe(7);
  });
});
