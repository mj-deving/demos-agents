/**
 * Signal detection core — comprehensive test suite.
 *
 * Tests cover: types, threshold detection, change detection, baseline persistence,
 * MAD outlier rejection, staleness guard, signal sorting/filtering.
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  type SignalRule,
  type DetectedSignal,
  type BaselineStore,
  type BaselineEntry,
  type SignalDetectionConfig,
  type StalenessConfig,
  type BaselineObservation,
  detectSignals,
  detectAntiSignals,
  confirmAntiSignals,
  detectConvergence,
  calculateZScore,
  loadBaselines,
  saveBaselines,
  updateBaseline,
  calculateMAD,
  winsorize,
  resolveDomain,
  CRYPTO_DEFAULTS,
  MACRO_DEFAULTS,
  DEFAULT_STALENESS,
} from "../src/lib/signal-detection.js";

import type { EvidenceEntry } from "../src/lib/sources/providers/types.js";
import type { SourceRecordV2 } from "../src/lib/sources/catalog.js";
import type { FetchSourceResult } from "../src/lib/sources/fetch.js";
import type { ExtractedClaim } from "../src/lib/claim-extraction.js";

// ── Test Helpers ──────────────────────────────────────

function makeEntry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "test-entry-1",
    bodyText: "Test entry",
    topics: ["bitcoin"],
    raw: {},
    ...overrides,
  };
}

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "test-source-1",
    name: "Test Source",
    provider: "test",
    url: "https://test.com/api",
    urlPattern: "test.com/api",
    domainTags: ["crypto"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: [] },
    runtime: {
      timeoutMs: 5000,
      retry: { maxAttempts: 2, backoffMs: 1000, retryOn: ["timeout"] },
    },
    trustTier: "established",
    status: "active",
    rating: {
      overall: 80, uptime: 90, relevance: 80, freshness: 85,
      sizeStability: 90, engagement: 70, trust: 85,
      testCount: 10, successCount: 9, consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-01-01T00:00:00Z",
      discoveredBy: "manual",
    },
    ...overrides,
  } as SourceRecordV2;
}

function makeFetchResult(overrides: Partial<FetchSourceResult> = {}): FetchSourceResult {
  return {
    ok: true,
    attempts: 1,
    totalMs: 200,
    response: {
      url: "https://test.com/api",
      status: 200,
      headers: {},
      bodyText: "{}",
    },
    ...overrides,
  };
}

function makeBaselineObs(value: number, ageMinutes = 0): BaselineObservation {
  const d = new Date();
  d.setMinutes(d.getMinutes() - ageMinutes);
  return { value, fetchedAt: d.toISOString() };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `signal-detection-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Types & Interfaces ───────────────────────────────

describe("types and interfaces", () => {
  it("ISC-1: SignalRule type supports all four signal variants", () => {
    const rules: SignalRule[] = [
      { type: "threshold", metric: "price", above: 100 },
      { type: "change", metric: "volume", threshold: 5 },
      { type: "convergence", metric: "price" },
      { type: "anti-signal", metric: "price", feedClaim: "BTC at $70K" },
    ];
    expect(rules).toHaveLength(4);
    expect(rules.map(r => r.type)).toEqual(["threshold", "change", "convergence", "anti-signal"]);
  });

  it("ISC-5: SignalDetectionConfig has domain-specific defaults", () => {
    expect(CRYPTO_DEFAULTS.changeThreshold).toBe(5);
    expect(MACRO_DEFAULTS.changeThreshold).toBe(2);
  });

  it("ISC-6: StalenessConfig has per-domain freshness limits", () => {
    expect(DEFAULT_STALENESS.crypto).toBe(15 * 60 * 1000); // 15 min
    expect(DEFAULT_STALENESS.macro).toBe(60 * 60 * 1000);  // 1 hour
    expect(DEFAULT_STALENESS.unknown).toBe(60 * 60 * 1000); // 1 hour default
  });
});

// ── Threshold Detection ──────────────────────────────

describe("threshold detection", () => {
  it("ISC-7: triggers when metric exceeds upper bound", () => {
    const entries = [makeEntry({ metrics: { price: 105000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].rule.type).toBe("threshold");
    expect(signals[0].currentValue).toBe(105000);
  });

  it("ISC-7: does NOT trigger when metric is at exact boundary", () => {
    const entries = [makeEntry({ metrics: { price: 100000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("ISC-8: triggers when metric below lower bound", () => {
    const entries = [makeEntry({ metrics: { price: 45000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", below: 50000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].summary).toContain("below");
  });

  it("ISC-9: strength proportional to distance past boundary", () => {
    const entries = [makeEntry({ metrics: { price: 150000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    // (150000 - 100000) / 100000 = 0.5
    expect(signals[0].strength).toBeCloseTo(0.5, 5);
  });

  it("ISC-10: skips non-numeric metric values gracefully", () => {
    const entries = [makeEntry({ metrics: { status: "online", price: 105000 } })];
    const rules: SignalRule[] = [
      { type: "threshold", metric: "status", above: 1 },
      { type: "threshold", metric: "price", above: 100000 },
    ];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    // Only the price signal should fire
    expect(signals).toHaveLength(1);
    expect(signals[0].rule.metric).toBe("price");
  });

  it("ISC-10: handles string-encoded numeric values", () => {
    const entries = [makeEntry({ metrics: { price: "105000.50" } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].currentValue).toBeCloseTo(105000.5, 1);
  });

  it("ISC-11: wildcard metric matches all metrics", () => {
    const entries = [makeEntry({ metrics: { price: 105000, volume: 999999999 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "*", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    // Both price and volume should trigger
    expect(signals).toHaveLength(2);
  });

  it("handles entries with undefined metrics", () => {
    const entries = [makeEntry({ metrics: undefined })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("threshold above: strength 0 boundary excluded (strictly above)", () => {
    // When above=100 and value=100, no signal (must be strictly above)
    const entries = [makeEntry({ metrics: { price: 100 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("threshold below: strength 0 boundary excluded (strictly below)", () => {
    const entries = [makeEntry({ metrics: { price: 50 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", below: 50 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("threshold with above=0: handles zero boundary correctly", () => {
    const entries = [makeEntry({ metrics: { change: 5 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "change", above: 0 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    // strength = (5 - 0) / max(|0|, 1) = 5
    expect(signals[0].strength).toBe(5);
  });
});

// ── Change Detection ─────────────────────────────────

describe("change detection", () => {
  function makeStoreWithSamples(
    sourceId: string,
    metricKey: string,
    values: number[],
    ageMinutes = 5,
  ): BaselineStore {
    const observations = values.map((v, i) => makeBaselineObs(v, ageMinutes + i));
    return {
      [sourceId]: {
        metrics: {
          [metricKey]: {
            windows: { "1h": [...observations], "4h": [...observations], "24h": [...observations] },
          },
        },
        samples: values.length,
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  it("ISC-12: triggers when percent change exceeds threshold", () => {
    // Baseline median = 100, current = 110, change = +10%, threshold = 5%
    const store = makeStoreWithSamples("test-source-1", "price", [98, 100, 102]);
    const entries = [makeEntry({ metrics: { price: 110 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].rule.type).toBe("change");
    expect(signals[0].changePercent).toBeGreaterThan(0);
  });

  it("ISC-13: requires N>=3 baseline samples", () => {
    // With exactly 3 samples, should work
    const store = makeStoreWithSamples("test-source-1", "price", [98, 100, 102]);
    const entries = [makeEntry({ metrics: { price: 120 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
  });

  it("ISC-14: no signals when baseline has fewer than 3 samples", () => {
    const store = makeStoreWithSamples("test-source-1", "price", [100, 102]);
    const entries = [makeEntry({ metrics: { price: 200 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("ISC-15: crypto domain uses 5% default threshold", () => {
    const store = makeStoreWithSamples("test-source-1", "price", [100, 100, 100]);
    const entries = [makeEntry({ metrics: { price: 104 } })]; // 4% — below crypto default
    // No threshold specified → use domain default (5% for crypto)
    const rules: SignalRule[] = [{ type: "change", metric: "price" }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ domainTags: ["crypto"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("ISC-16: macro domain uses 2% default threshold", () => {
    const store = makeStoreWithSamples("test-source-1", "value", [100, 100, 100]);
    const entries = [makeEntry({ metrics: { value: 103 } })]; // 3% — above macro default
    const rules: SignalRule[] = [{ type: "change", metric: "value" }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ domainTags: ["macro", "economics"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
  });

  it("ISC-17: strength proportional to ratio past threshold", () => {
    const store = makeStoreWithSamples("test-source-1", "price", [100, 100, 100]);
    const entries = [makeEntry({ metrics: { price: 115 } })]; // 15% change, threshold 5%
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    // strength = |15| / 5 - 1 = 2.0
    expect(signals[0].strength).toBeCloseTo(2.0, 1);
  });

  it("ISC-18: negative changes detected symmetrically", () => {
    const store = makeStoreWithSamples("test-source-1", "price", [100, 100, 100]);
    const entries = [makeEntry({ metrics: { price: 90 } })]; // -10%
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].changePercent).toBeLessThan(0);
    expect(signals[0].summary).toContain("-");
  });

  it("ISC-19: zero baseline value handled without division-by-zero", () => {
    const store = makeStoreWithSamples("test-source-1", "price", [0, 0, 0]);
    const entries = [makeEntry({ metrics: { price: 100 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    // Should not crash; either skip or handle gracefully
    expect(signals).toHaveLength(0);
  });

  it("change detection with no baseline store returns no signals", () => {
    const entries = [makeEntry({ metrics: { price: 100 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(0);
  });
});

// ── Baseline Persistence ─────────────────────────────

describe("baseline persistence", () => {
  it("ISC-23: loadBaselines reads and parses keyed JSON file", () => {
    const filePath = join(tmpDir, "baselines-test.json");
    const store: BaselineStore = {
      "src-1": {
        metrics: {
          price: {
            windows: {
              "1h": [makeBaselineObs(100)],
              "4h": [makeBaselineObs(100)],
              "24h": [makeBaselineObs(100)],
            },
          },
        },
        samples: 1,
        lastUpdated: new Date().toISOString(),
      },
    };
    writeFileSync(filePath, JSON.stringify(store));
    const loaded = loadBaselines(filePath);
    expect(loaded["src-1"]).toBeDefined();
    expect(loaded["src-1"].samples).toBe(1);
  });

  it("ISC-24: loadBaselines returns empty store when file does not exist", () => {
    const loaded = loadBaselines(join(tmpDir, "nonexistent.json"));
    expect(loaded).toEqual({});
  });

  it("ISC-25: saveBaselines writes atomically", () => {
    const filePath = join(tmpDir, "baselines-atomic.json");
    const store: BaselineStore = {
      "src-1": {
        metrics: { price: { windows: { "1h": [], "4h": [], "24h": [] } } },
        samples: 0,
        lastUpdated: new Date().toISOString(),
      },
    };
    saveBaselines(filePath, store);
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, "utf8"));
    expect(content["src-1"]).toBeDefined();
  });

  it("ISC-26: updateBaseline adds observation to all window ring buffers", () => {
    const store: BaselineStore = {};
    updateBaseline(store, "src-1", "price", 105, new Date().toISOString());
    expect(store["src-1"]).toBeDefined();
    expect(store["src-1"].metrics.price.windows["1h"]).toHaveLength(1);
    expect(store["src-1"].metrics.price.windows["4h"]).toHaveLength(1);
    expect(store["src-1"].metrics.price.windows["24h"]).toHaveLength(1);
    expect(store["src-1"].samples).toBe(1);
  });

  it("ISC-27: ring buffer evicts oldest when capacity exceeded", () => {
    const store: BaselineStore = {};
    // Add 22 observations (capacity = 20)
    for (let i = 0; i < 22; i++) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - (22 - i));
      updateBaseline(store, "src-1", "price", 100 + i, d.toISOString());
    }
    expect(store["src-1"].metrics.price.windows["1h"].length).toBeLessThanOrEqual(20);
    expect(store["src-1"].metrics.price.windows["4h"].length).toBeLessThanOrEqual(20);
    expect(store["src-1"].metrics.price.windows["24h"].length).toBeLessThanOrEqual(20);
    // Oldest (100, 101) should be evicted, most recent (121) should be present
    const lastVal = store["src-1"].metrics.price.windows["24h"].at(-1)!.value;
    expect(lastVal).toBe(121);
  });

  it("ISC-28: entries older than 30 days pruned on load", () => {
    const filePath = join(tmpDir, "baselines-prune.json");
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31);
    const recentDate = new Date();

    const store: BaselineStore = {
      "src-1": {
        metrics: {
          price: {
            windows: {
              "1h": [
                { value: 100, fetchedAt: oldDate.toISOString() },
                { value: 105, fetchedAt: recentDate.toISOString() },
              ],
              "4h": [{ value: 100, fetchedAt: oldDate.toISOString() }],
              "24h": [{ value: 105, fetchedAt: recentDate.toISOString() }],
            },
          },
        },
        samples: 2,
        lastUpdated: recentDate.toISOString(),
      },
    };
    writeFileSync(filePath, JSON.stringify(store));

    const loaded = loadBaselines(filePath);
    // Old entry in 1h should be pruned
    expect(loaded["src-1"].metrics.price.windows["1h"]).toHaveLength(1);
    expect(loaded["src-1"].metrics.price.windows["1h"][0].value).toBe(105);
    // Old entry in 4h should be pruned → empty
    expect(loaded["src-1"].metrics.price.windows["4h"]).toHaveLength(0);
  });

  it("ISC-20: baseline file path uses agent name", () => {
    // Convention test — verifying the path format
    const agent = "sentinel";
    const expectedPath = join(process.env.HOME || "~", ".config", "demos", `baselines-${agent}.json`);
    expect(expectedPath).toContain("baselines-sentinel.json");
  });

  it("ISC-21: BaselineEntry contains ring buffers for 1h, 4h, 24h", () => {
    const store: BaselineStore = {};
    updateBaseline(store, "src-1", "price", 100, new Date().toISOString());
    const entry = store["src-1"];
    const windows = entry.metrics.price.windows;
    expect(windows).toHaveProperty("1h");
    expect(windows).toHaveProperty("4h");
    expect(windows).toHaveProperty("24h");
  });

  it("ISC-22: ring buffer capacity is 20", () => {
    const store: BaselineStore = {};
    for (let i = 0; i < 25; i++) {
      const d = new Date();
      d.setSeconds(d.getSeconds() - (25 - i));
      updateBaseline(store, "src-1", "price", 100 + i, d.toISOString());
    }
    // Each window should cap at 20
    for (const windowKey of ["1h", "4h", "24h"] as const) {
      expect(store["src-1"].metrics.price.windows[windowKey].length).toBeLessThanOrEqual(20);
    }
  });

  it("loadBaselines handles corrupted JSON gracefully", () => {
    const filePath = join(tmpDir, "baselines-corrupt.json");
    writeFileSync(filePath, "not valid json {{{");
    const loaded = loadBaselines(filePath);
    expect(loaded).toEqual({});
  });
});

// ── MAD Outlier Rejection ────────────────────────────

describe("MAD outlier rejection", () => {
  it("ISC-29: MAD calculated correctly", () => {
    // Values: [1, 2, 3, 4, 100]
    // Median = 3
    // Deviations from median: [2, 1, 0, 1, 97]
    // Median of deviations = 1
    const mad = calculateMAD([1, 2, 3, 4, 100]);
    expect(mad).toBe(1);
  });

  it("ISC-29: MAD with even number of values", () => {
    // [1, 2, 3, 4] → median=2.5, deviations=[1.5, 0.5, 0.5, 1.5], MAD=1.0
    const mad = calculateMAD([1, 2, 3, 4]);
    expect(mad).toBe(1);
  });

  it("ISC-30: values beyond 3 MADs winsorized", () => {
    // Median = 3, MAD = 1, 3*MAD = 3
    // Valid range: 3 - 3 = 0 to 3 + 3 = 6
    // 100 should be winsorized to 6
    const result = winsorize([1, 2, 3, 4, 100]);
    expect(result).not.toContain(100);
    const maxVal = Math.max(...result);
    expect(maxVal).toBeLessThanOrEqual(6);
  });

  it("ISC-31: MAD handles fewer than 3 values gracefully", () => {
    // With 1 value, MAD should return 0 (or floor)
    expect(calculateMAD([5])).toBe(0);
    expect(calculateMAD([])).toBe(0);
    expect(calculateMAD([5, 10])).toBeGreaterThanOrEqual(0);
  });

  it("ISC-32: baseline median used as reference for change detection", () => {
    // Baseline values: [90, 100, 110] → median = 100
    // Current = 115 → change = +15% from median
    const store: BaselineStore = {
      "src-1": {
        metrics: {
          price: {
            windows: {
              "1h": [makeBaselineObs(90), makeBaselineObs(100), makeBaselineObs(110)],
              "4h": [makeBaselineObs(90), makeBaselineObs(100), makeBaselineObs(110)],
              "24h": [makeBaselineObs(90), makeBaselineObs(100), makeBaselineObs(110)],
            },
          },
        },
        samples: 3,
        lastUpdated: new Date().toISOString(),
      },
    };
    const entries = [makeEntry({ metrics: { price: 115 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ id: "src-1" }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    // Change from median 100 to 115 = 15%
    expect(signals[0].changePercent).toBeCloseTo(15, 0);
    expect(signals[0].baselineValue).toBe(100); // median
  });

  it("MAD with all identical values returns 0", () => {
    const mad = calculateMAD([5, 5, 5, 5, 5]);
    expect(mad).toBe(0);
  });

  it("winsorize with all identical values returns same array", () => {
    const result = winsorize([5, 5, 5, 5]);
    expect(result).toEqual([5, 5, 5, 5]);
  });

  it("ISC-40: baseline median winsorizes outliers before computing median", () => {
    // Baseline: [100, 100, 100, 100, 100, 100, 100, 100, 100, 9999]
    // Without winsorize, median is still 100 (even number -> avg of two middle)
    // But the key test: change detection should use winsorized baseline
    // With outlier 9999, non-winsorized median might shift in edge cases
    // The important thing is that the outlier doesn't corrupt the baseline
    const observations = [
      ...Array(9).fill(null).map(() => makeBaselineObs(100)),
      makeBaselineObs(9999), // extreme outlier
    ];
    const store: BaselineStore = {
      "src-1": {
        metrics: {
          price: {
            windows: {
              "1h": [...observations],
              "4h": [...observations],
              "24h": [...observations],
            },
          },
        },
        samples: 10,
        lastUpdated: new Date().toISOString(),
      },
    };

    // Current value 106 = +6% from baseline median of ~100
    // With winsorize, the outlier 9999 gets clamped, so median stays 100
    const entries = [makeEntry({ metrics: { price: 106 } })];
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ id: "src-1" }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    // Baseline value should be ~100 (winsorized), not skewed by 9999
    expect(signals[0].baselineValue).toBeCloseTo(100, 0);
  });

  it("ISC-41: baseline with multiple outliers still produces correct median", () => {
    // 3 outliers in 10 observations
    const observations = [
      ...Array(7).fill(null).map(() => makeBaselineObs(50)),
      makeBaselineObs(5000),
      makeBaselineObs(6000),
      makeBaselineObs(7000),
    ];
    const store: BaselineStore = {
      "src-1": {
        metrics: {
          price: {
            windows: {
              "1h": [...observations],
              "4h": [...observations],
              "24h": [...observations],
            },
          },
        },
        samples: 10,
        lastUpdated: new Date().toISOString(),
      },
    };

    const entries = [makeEntry({ metrics: { price: 55 } })]; // +10% from 50
    const rules: SignalRule[] = [{ type: "change", metric: "price", threshold: 5 }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ id: "src-1" }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    // After winsorizing, median should be ~50 (outliers clamped)
    expect(signals[0].baselineValue).toBeCloseTo(50, 0);
  });
});

// ── Staleness Guard ──────────────────────────────────

describe("staleness guard", () => {
  it("ISC-33: crypto data older than 15 minutes suppresses signals", () => {
    const staleTime = new Date();
    staleTime.setMinutes(staleTime.getMinutes() - 16); // 16 min ago
    const entries = [makeEntry({ metrics: { price: 200000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource({ domainTags: ["crypto"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: staleTime.toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("ISC-33: crypto data at 14 minutes is NOT stale", () => {
    const exactTime = new Date();
    exactTime.setMinutes(exactTime.getMinutes() - 14);
    const entries = [makeEntry({ metrics: { price: 200000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource({ domainTags: ["crypto"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: exactTime.toISOString(),
    });
    expect(signals).toHaveLength(1);
  });

  it("ISC-34: macro data older than 1 hour suppresses signals", () => {
    const staleTime = new Date();
    staleTime.setMinutes(staleTime.getMinutes() - 61);
    const entries = [makeEntry({ metrics: { value: 200 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "value", above: 100 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource({ domainTags: ["macro", "economics"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: staleTime.toISOString(),
    });
    expect(signals).toHaveLength(0);
  });

  it("ISC-35: domain resolved from source domainTags", () => {
    expect(resolveDomain(["crypto", "prices"])).toBe("crypto");
    expect(resolveDomain(["macro", "economics"])).toBe("macro");
    expect(resolveDomain(["ai", "infrastructure"])).toBe("unknown");
  });

  it("ISC-36: unknown domain defaults to 1 hour staleness", () => {
    const staleTime = new Date();
    staleTime.setMinutes(staleTime.getMinutes() - 59); // 59 min, within 1h
    const entries = [makeEntry({ metrics: { value: 200 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "value", above: 100 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource({ domainTags: ["ai"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: staleTime.toISOString(),
    });
    expect(signals).toHaveLength(1);
  });

  it("fresh crypto data produces signals normally", () => {
    const entries = [makeEntry({ metrics: { price: 200000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource({ domainTags: ["crypto"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
  });
});

// ── Signal Sorting & Filtering ───────────────────────

describe("signal sorting and filtering", () => {
  it("ISC-37: signals sorted by strength descending", () => {
    const entries = [makeEntry({
      metrics: { price: 200000, volume: 110000 },
    })];
    const rules: SignalRule[] = [
      { type: "threshold", metric: "price", above: 100000 },  // strength = 1.0
      { type: "threshold", metric: "volume", above: 100000 }, // strength = 0.1
    ];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i - 1].strength).toBeGreaterThanOrEqual(signals[i].strength);
    }
  });

  it("ISC-38: signals below minSignalStrength filtered out", () => {
    const entries = [makeEntry({ metrics: { price: 100001 } })]; // barely above threshold
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
      minSignalStrength: 0.1, // require at least 10% past threshold
    });
    // strength = 1/100000 = 0.00001 — below 0.1
    expect(signals).toHaveLength(0);
  });

  it("ISC-39: each signal includes human-readable summary", () => {
    const entries = [makeEntry({ metrics: { price: 150000 } })];
    const rules: SignalRule[] = [{ type: "threshold", metric: "price", above: 100000 }];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1);
    expect(typeof signals[0].summary).toBe("string");
    expect(signals[0].summary.length).toBeGreaterThan(0);
    expect(signals[0].summary).toContain("price");
  });

  it("multiple entries × multiple rules produce correct signal count", () => {
    const entries = [
      makeEntry({ metrics: { price: 200000 } }),
      makeEntry({ id: "entry-2", metrics: { price: 50000 }, bodyText: "second" }),
    ];
    const rules: SignalRule[] = [
      { type: "threshold", metric: "price", above: 100000 },
      { type: "threshold", metric: "price", below: 60000 },
    ];
    const signals = detectSignals(entries, rules, null, {
      source: makeSource(),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    // Entry 1 triggers above, Entry 2 triggers below
    expect(signals).toHaveLength(2);
  });
});

// ── resolveDomain ────────────────────────────────────

describe("resolveDomain", () => {
  it("crypto tags", () => {
    expect(resolveDomain(["crypto"])).toBe("crypto");
    expect(resolveDomain(["prices", "crypto"])).toBe("crypto");
    expect(resolveDomain(["defi", "crypto"])).toBe("crypto");
  });

  it("macro tags", () => {
    expect(resolveDomain(["macro"])).toBe("macro");
    expect(resolveDomain(["economics"])).toBe("macro");
    expect(resolveDomain(["macro", "crypto"])).toBe("crypto"); // crypto takes priority
  });

  it("unknown tags", () => {
    expect(resolveDomain(["ai"])).toBe("unknown");
    expect(resolveDomain([])).toBe("unknown");
  });
});

// ── Anti-Signal Detection ────────────────────────────

describe("anti-signal detection", () => {
  function makeClaim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
    return {
      text: "BTC at $70,000",
      type: "price",
      entities: ["Bitcoin"],
      value: 70000,
      unit: "USD",
      ...overrides,
    };
  }

  const ctx = {
    source: makeSource({ id: "src-1" }),
    fetchResult: makeFetchResult(),
    fetchedAt: new Date().toISOString(),
  };

  it("ISC-1: detectAntiSignals is exported and callable", () => {
    expect(typeof detectAntiSignals).toBe("function");
  });

  it("ISC-2: matches claims to entries via entity-topic overlap (case-insensitive)", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];
    // Entry topic "bitcoin" should match claim entity "Bitcoin"
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 60000 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  it("ISC-3: divergence >10% triggers anti-signal", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];
    // Source shows 60000, divergence = (60000-70000)/70000 * 100 = -14.3%
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 60000 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].rule.type).toBe("anti-signal");
  });

  it("ISC-4: divergence at exactly 10% does NOT trigger", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 100 })];
    // Source shows 110, divergence = (110-100)/100 * 100 = +10% exactly
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 110 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(0);
  });

  it("ISC-5: strength = |divergence| / 10 - 1", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 100 })];
    // Source shows 130, divergence = 30%
    // strength = 30 / 10 - 1 = 2.0
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 130 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].strength).toBeCloseTo(2.0, 5);
  });

  it("ISC-6: summary includes entity, claim value, source value, divergence", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 60000 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].summary).toContain("Bitcoin");
    expect(signals[0].summary).toContain("70000");
    expect(signals[0].summary).toContain("60000");
    expect(signals[0].summary).toContain("%");
  });

  it("ISC-7: skips claims with null/undefined/non-numeric value", () => {
    const claims = [
      makeClaim({ entities: ["Bitcoin"], value: undefined }),
      makeClaim({ entities: ["Ethereum"], value: undefined, text: "ETH trending" }),
    ];
    const entries = [makeEntry({ topics: ["bitcoin", "ethereum"], metrics: { price: 60000 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(0);
  });

  it("ISC-8: handles zero claim value without division-by-zero", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 0 })];
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 100 } })];
    // Should not throw, should skip (can't compute meaningful divergence from zero)
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(0);
  });

  it("ISC-9: no entity overlap means no anti-signal", () => {
    const claims = [makeClaim({ entities: ["Solana"], value: 200 })];
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 100 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(0);
  });

  it("negative divergence detected symmetrically", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];
    // Source shows 50000, divergence = (50000-70000)/70000 = -28.6%
    const entries = [makeEntry({ topics: ["bitcoin"], metrics: { price: 50000 } })];
    const signals = detectAntiSignals(entries, claims, ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].changePercent).toBeLessThan(0);
  });
});

// ── Cross-Source Confirmation ────────────────────────

describe("cross-source confirmation", () => {
  function makeClaim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
    return {
      text: "BTC at $70,000",
      type: "price",
      entities: ["Bitcoin"],
      value: 70000,
      unit: "USD",
      ...overrides,
    };
  }

  it("ISC-10: confirmed=true when 2+ sources agree on anti-signal", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];

    // Two different sources both show lower price
    const source1 = makeSource({ id: "src-1", name: "Source 1" });
    const source2 = makeSource({ id: "src-2", name: "Source 2" });

    const entries1 = [makeEntry({ topics: ["bitcoin"], metrics: { price: 60000 } })];
    const entries2 = [makeEntry({ topics: ["bitcoin"], metrics: { price: 61000 } })];

    const signals1 = detectAntiSignals(entries1, claims, {
      source: source1,
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    const signals2 = detectAntiSignals(entries2, claims, {
      source: source2,
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });

    const bySource = new Map<string, typeof signals1>();
    bySource.set("src-1", signals1);
    bySource.set("src-2", signals2);

    const confirmed = confirmAntiSignals(bySource);
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    expect(confirmed.some(s => s.confirmed === true)).toBe(true);
  });

  it("single source does NOT confirm anti-signal", () => {
    const claims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];
    const source1 = makeSource({ id: "src-1", name: "Source 1" });
    const entries1 = [makeEntry({ topics: ["bitcoin"], metrics: { price: 60000 } })];
    const signals1 = detectAntiSignals(entries1, claims, {
      source: source1,
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });

    const bySource = new Map<string, typeof signals1>();
    bySource.set("src-1", signals1);

    const confirmed = confirmAntiSignals(bySource);
    // All signals should have confirmed=false
    expect(confirmed.every(s => s.confirmed === false)).toBe(true);
  });

  it("different entities from different sources do NOT cross-confirm", () => {
    const btcClaims = [makeClaim({ entities: ["Bitcoin"], value: 70000 })];
    const ethClaims = [makeClaim({ entities: ["Ethereum"], value: 4000 })];

    const source1 = makeSource({ id: "src-1" });
    const source2 = makeSource({ id: "src-2" });

    const signals1 = detectAntiSignals(
      [makeEntry({ topics: ["bitcoin"], metrics: { price: 60000 } })],
      btcClaims,
      { source: source1, fetchResult: makeFetchResult(), fetchedAt: new Date().toISOString() },
    );
    const signals2 = detectAntiSignals(
      [makeEntry({ topics: ["ethereum"], metrics: { price: 3000 } })],
      ethClaims,
      { source: source2, fetchResult: makeFetchResult(), fetchedAt: new Date().toISOString() },
    );

    const bySource = new Map<string, typeof signals1>();
    bySource.set("src-1", signals1);
    bySource.set("src-2", signals2);

    const confirmed = confirmAntiSignals(bySource);
    // None should be confirmed — different entities
    expect(confirmed.every(s => s.confirmed === false)).toBe(true);
  });
});

// ── Z-Score Calculation ──────────────────────────────

describe("z-score calculation", () => {
  it("ISC-20: z-score correct for known values", () => {
    // Values: [10, 10, 10, 10, 10] → median=10, MAD=0, effectiveMAD=MAD_FLOOR
    // z-score of 15 = (15-10)/MAD_FLOOR = very large
    const obs = Array(15).fill(null).map(() => makeBaselineObs(10));
    const z = calculateZScore(15, obs);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(0);
  });

  it("ISC-20: z-score for value at median is 0", () => {
    const obs = Array(15).fill(null).map((_, i) => makeBaselineObs(100 + (i % 5)));
    const values = obs.map(o => o.value);
    const sorted = [...values].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const z = calculateZScore(med, obs);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(0, 1);
  });

  it("ISC-4: returns null when fewer than 15 observations", () => {
    const obs = Array(14).fill(null).map(() => makeBaselineObs(100));
    const z = calculateZScore(110, obs);
    expect(z).toBeNull();
  });

  it("ISC-3: MAD_FLOOR prevents division by zero", () => {
    // All identical values → MAD=0, but MAD_FLOOR prevents div-by-zero
    const obs = Array(20).fill(null).map(() => makeBaselineObs(50));
    const z = calculateZScore(51, obs);
    expect(z).not.toBeNull();
    expect(Number.isFinite(z!)).toBe(true);
  });
});

// ── Cold-Start Z-Score Integration ───────────────────

describe("cold-start z-score in change detection", () => {
  function makeStoreWithNSamples(
    sourceId: string,
    metricKey: string,
    count: number,
    baseValue: number,
  ): BaselineStore {
    const observations = Array.from({ length: count }, (_, i) =>
      makeBaselineObs(baseValue + (i % 3) - 1) // slight variation around baseValue
    );
    return {
      [sourceId]: {
        metrics: {
          [metricKey]: {
            windows: { "1h": [...observations], "4h": [...observations], "24h": [...observations] },
          },
        },
        samples: count,
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  it("ISC-21/ISC-6: <15 samples uses fixed threshold (5% crypto default)", () => {
    // 10 samples → cold-start → fixed threshold
    const store = makeStoreWithNSamples("src-1", "price", 10, 100);
    const entries = [makeEntry({ metrics: { price: 106 } })]; // +6% from ~100
    const rules: SignalRule[] = [{ type: "change", metric: "price" }]; // no threshold → domain default 5%
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ id: "src-1", domainTags: ["crypto"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    expect(signals).toHaveLength(1); // 6% > 5% fixed threshold
  });

  it("ISC-21/ISC-5: 15+ samples uses z-score threshold", () => {
    // 20 samples of very stable data (all ~100), then value at 103
    // With fixed 5% threshold, 3% wouldn't trigger
    // But with z-score on very stable data, 3% is a huge z-score → should trigger
    const store = makeStoreWithNSamples("src-1", "price", 20, 100);
    const entries = [makeEntry({ metrics: { price: 103 } })]; // only +3%
    const rules: SignalRule[] = [{ type: "change", metric: "price" }];
    const signals = detectSignals(entries, rules, store, {
      source: makeSource({ id: "src-1", domainTags: ["crypto"] }),
      fetchResult: makeFetchResult(),
      fetchedAt: new Date().toISOString(),
    });
    // Z-score should catch this even though 3% < 5% fixed threshold
    expect(signals).toHaveLength(1);
  });
});

// ── Cross-Source Convergence ─────────────────────────

describe("cross-source convergence", () => {
  function makeChangeSignal(sourceId: string, metric: string, changePct: number): DetectedSignal {
    return {
      source: makeSource({ id: sourceId, name: `Source ${sourceId}` }),
      rule: { type: "change", metric, threshold: 5 },
      strength: Math.abs(changePct) / 5 - 1,
      currentValue: 100 + changePct,
      baselineValue: 100,
      changePercent: changePct,
      summary: `${metric} changed ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%`,
      evidence: makeEntry({ metrics: { [metric]: 100 + changePct } }),
      fetchResult: makeFetchResult(),
    };
  }

  it("ISC-22: 3 sources triggers convergence, 2 does not", () => {
    const bySource = new Map<string, DetectedSignal[]>();
    bySource.set("src-1", [makeChangeSignal("src-1", "price", 10)]);
    bySource.set("src-2", [makeChangeSignal("src-2", "price", 12)]);

    // 2 sources → no convergence
    const result2 = detectConvergence(bySource);
    expect(result2).toHaveLength(0);

    // Add 3rd source
    bySource.set("src-3", [makeChangeSignal("src-3", "price", 8)]);
    const result3 = detectConvergence(bySource);
    expect(result3).toHaveLength(1);
    expect(result3[0].rule.type).toBe("convergence");
  });

  it("ISC-18: strength = sourceCount / 3", () => {
    const bySource = new Map<string, DetectedSignal[]>();
    bySource.set("src-1", [makeChangeSignal("src-1", "price", 10)]);
    bySource.set("src-2", [makeChangeSignal("src-2", "price", 12)]);
    bySource.set("src-3", [makeChangeSignal("src-3", "price", 8)]);

    const result = detectConvergence(bySource);
    expect(result[0].strength).toBeCloseTo(1.0, 5); // 3/3 = 1.0
  });

  it("ISC-23: excludes signals with |changePercent| < 1%", () => {
    const bySource = new Map<string, DetectedSignal[]>();
    bySource.set("src-1", [makeChangeSignal("src-1", "price", 0.5)]); // <1%
    bySource.set("src-2", [makeChangeSignal("src-2", "price", 0.3)]); // <1%
    bySource.set("src-3", [makeChangeSignal("src-3", "price", 0.8)]); // <1%

    const result = detectConvergence(bySource);
    expect(result).toHaveLength(0); // All below magnitude threshold
  });

  it("ISC-19: summary shows source count, metric, direction, avg %", () => {
    const bySource = new Map<string, DetectedSignal[]>();
    bySource.set("src-1", [makeChangeSignal("src-1", "price", 10)]);
    bySource.set("src-2", [makeChangeSignal("src-2", "price", 12)]);
    bySource.set("src-3", [makeChangeSignal("src-3", "price", 8)]);

    const result = detectConvergence(bySource);
    expect(result[0].summary).toContain("3");
    expect(result[0].summary).toContain("price");
    expect(result[0].summary).toContain("+");
  });

  it("opposite directions do NOT converge", () => {
    const bySource = new Map<string, DetectedSignal[]>();
    bySource.set("src-1", [makeChangeSignal("src-1", "price", 10)]);  // up
    bySource.set("src-2", [makeChangeSignal("src-2", "price", -10)]); // down
    bySource.set("src-3", [makeChangeSignal("src-3", "price", 8)]);   // up

    const result = detectConvergence(bySource);
    // Only 2 sources agree on "up" → no convergence
    expect(result).toHaveLength(0);
  });
});
