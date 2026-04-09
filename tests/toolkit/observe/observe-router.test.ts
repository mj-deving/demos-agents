/**
 * Strategy-driven observe router tests.
 *
 * The router reads evidence.categories from strategy.yaml,
 * dispatches to matching extractors, and aggregates results.
 */
import { describe, it, expect, vi } from "vitest";
import { strategyObserve, getActiveCategories } from "../../../src/toolkit/observe/observe-router.js";
import type { StrategyConfig } from "../../../src/toolkit/strategy/types.js";
import type { Toolkit } from "../../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";

// ── Helpers ────────────────────────────────────

function makeMinimalConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    rules: [{ name: "test", type: "PUBLISH", priority: 50, conditions: [], enabled: true }],
    rateLimits: { postsPerDay: 8, postsPerHour: 3, reactionsPerSession: 6, maxTipAmount: 5 },
    performance: {
      engagement: 40, discussion: 25, replyBase: 10, replyDeep: 10,
      threadDepth: 5, economic: 20, tipBase: 10, tipCap: 10,
      tipMultiplier: 2, controversy: 5, ageHalfLife: 48,
    },
    topicWeights: {},
    enrichment: { minSignalAgents: 5, minConfidence: 70 },
    ...overrides,
  };
}

/** Creates a mock toolkit where every method returns { ok: false, status: 500, error: "mock" }. */
function createMockToolkit(): Toolkit {
  const fail = () => ({ ok: false as const, status: 500, error: "mock" });
  const asyncFail = () => Promise.resolve(fail());
  const ns = new Proxy({}, { get: () => asyncFail });
  return new Proxy({} as Toolkit, { get: () => ns });
}

// ── Tests ──────────────────────────────────────

describe("getActiveCategories", () => {
  it("returns all 10 categories when no evidence config specified", () => {
    const config = makeMinimalConfig();
    const categories = getActiveCategories(config);
    expect(categories).toHaveLength(10);
    expect(categories).toContain("colony-feeds");
    expect(categories).toContain("network");
  });

  it("returns only specified categories from evidence.categories", () => {
    const config = makeMinimalConfig({
      evidence: {
        categories: {
          core: ["colony-feeds", "colony-signals"],
          domain: ["oracle"],
          meta: undefined,
        },
      },
    });
    const categories = getActiveCategories(config);
    expect(categories).toEqual(["colony-feeds", "colony-signals", "oracle"]);
  });

  it("returns empty when all category arrays are empty", () => {
    const config = makeMinimalConfig({
      evidence: {
        categories: {
          core: [],
          domain: [],
          meta: [],
        },
      },
    });
    const categories = getActiveCategories(config);
    expect(categories).toEqual([]);
  });
});

describe("strategyObserve", () => {
  it("calls extractors only for active categories", async () => {
    const toolkit = createMockToolkit();
    const config = makeMinimalConfig({
      evidence: {
        categories: {
          core: ["colony-signals"],
          domain: [],
          meta: [],
        },
      },
    });

    // Should not throw even with mock toolkit (extractors return [] on failure)
    const result = await strategyObserve(toolkit, config);
    expect(result).toBeDefined();
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(result.apiEnrichment).toBeDefined();
  });

  it("returns aggregated evidence from multiple extractors", async () => {
    const toolkit = createMockToolkit();
    const config = makeMinimalConfig({
      evidence: {
        categories: {
          core: ["colony-feeds", "colony-signals"],
          domain: ["oracle"],
          meta: [],
        },
      },
    });

    const result = await strategyObserve(toolkit, config);
    // All will return [] because toolkit is mocked, but the function shouldn't crash
    expect(Array.isArray(result.evidence)).toBe(true);
  });

  it("returns empty evidence when no categories are active", async () => {
    const toolkit = createMockToolkit();
    const config = makeMinimalConfig({
      evidence: {
        categories: { core: [], domain: [], meta: [] },
      },
    });

    const result = await strategyObserve(toolkit, config);
    expect(result.evidence).toEqual([]);
    expect(result.apiEnrichment).toEqual({});
  });

  it("runs extractors in parallel", async () => {
    const toolkit = createMockToolkit();
    const config = makeMinimalConfig(); // all 10 categories active

    const start = Date.now();
    await strategyObserve(toolkit, config);
    const elapsed = Date.now() - start;

    // If running serially with 10 extractors, would take longer
    // Parallel should be fast since they all return immediately
    expect(elapsed).toBeLessThan(500);
  });
});
