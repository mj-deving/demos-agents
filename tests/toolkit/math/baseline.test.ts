import { describe, expect, it } from "vitest";

import {
  RingBuffer,
  calculateMAD,
  calculateZScore,
  detectChangeAgainstBaseline,
  getBaselineMedian,
  recordBaselineValue,
  winsorize,
  type BaselineObservation,
  type BaselineStore,
} from "../../../src/toolkit/math/baseline.js";

function observation(value: number): BaselineObservation {
  return {
    value,
    fetchedAt: new Date().toISOString(),
  };
}

describe("toolkit baseline math", () => {
  it("caps ring buffer capacity and keeps newest values", () => {
    const buffer = new RingBuffer<number>(3);

    buffer.add(1);
    buffer.add(2);
    buffer.add(3);
    buffer.add(4);

    expect(buffer.get()).toEqual([2, 3, 4]);
  });

  it("calculates MAD for a known outlier set", () => {
    expect(calculateMAD([1, 2, 3, 4, 100])).toBe(1);
  });

  it("computes z-score against a baseline window", () => {
    const observations = Array.from({ length: 15 }, () => observation(10));
    const z = calculateZScore(15, observations);

    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(0);
  });

  it("detects change against a stored baseline", () => {
    const store: BaselineStore = {};
    recordBaselineValue(store, "src-1", "price", 90, new Date().toISOString());
    recordBaselineValue(store, "src-1", "price", 100, new Date().toISOString());
    recordBaselineValue(store, "src-1", "price", 110, new Date().toISOString());

    const baseline = getBaselineMedian(store, "src-1", "price");
    const change = detectChangeAgainstBaseline({
      store,
      sourceId: "src-1",
      metricKey: "price",
      currentValue: 115,
      threshold: 5,
    });

    expect(baseline).toBe(100);
    expect(change).toEqual({
      baselineValue: 100,
      changePercent: 15,
      sampleCount: 3,
      zScore: null,
    });
  });

  it("winsorizes extreme outliers before baseline math", () => {
    const result = winsorize([1, 2, 3, 4, 100]);
    expect(Math.max(...result)).toBeLessThanOrEqual(6);
  });
});
