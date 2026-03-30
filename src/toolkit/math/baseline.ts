/**
 * Baseline math primitives.
 *
 * Pure utilities only: ring buffers, robust statistics, and baseline tracking.
 * No domain thresholds, no source-specific evidence types, no strategy rules.
 */

export const RING_BUFFER_CAPACITY = 20;
export const MIN_BASELINE_SAMPLES = 3;
export const MAD_FLOOR = 0.001;
export const MAD_MULTIPLIER = 3;
export const MIN_ZSCORE_SAMPLES = 15;
export const ZSCORE_THRESHOLD = 2.5;

export type BaselineWindowKey = "1h" | "4h" | "24h";

export interface BaselineObservation {
  value: number;
  fetchedAt: string;
}

export interface MetricWindows {
  windows: Record<BaselineWindowKey, BaselineObservation[]>;
}

export interface BaselineEntry {
  metrics: Record<string, MetricWindows>;
  samples: number;
  lastUpdated: string;
}

export type BaselineStore = Record<string, BaselineEntry>;

export interface DetectBaselineChangeOptions {
  store: BaselineStore | null;
  sourceId: string;
  metricKey: string;
  currentValue: number;
  threshold: number;
  window?: BaselineWindowKey;
  minSamples?: number;
  zScoreThreshold?: number;
}

export interface BaselineChange {
  baselineValue: number;
  changePercent: number;
  sampleCount: number;
  zScore: number | null;
}

const WINDOW_KEYS: BaselineWindowKey[] = ["1h", "4h", "24h"];

export class RingBuffer<T> {
  private readonly values: T[] = [];

  constructor(private readonly capacity: number) {}

  add(value: T): void {
    this.values.push(value);
    while (this.values.length > this.capacity) {
      this.values.shift();
    }
  }

  get(): T[] {
    return [...this.values];
  }
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function calculateMAD(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const deviations = values.map((value) => Math.abs(value - med)).sort((a, b) => a - b);
  return median(deviations);
}

export function winsorize(values: number[]): number[] {
  if (values.length < 3) return [...values];
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = calculateMAD(values);
  const effectiveMad = Math.max(mad, MAD_FLOOR);
  const lower = med - MAD_MULTIPLIER * effectiveMad;
  const upper = med + MAD_MULTIPLIER * effectiveMad;
  return values.map((value) => Math.max(lower, Math.min(upper, value)));
}

export function calculateZScore(
  value: number,
  observations: BaselineObservation[],
): number | null {
  if (observations.length < MIN_ZSCORE_SAMPLES) return null;

  const values = observations.map((observation) => observation.value);
  const cleaned = winsorize(values);
  const sorted = [...cleaned].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = calculateMAD(cleaned);
  const effectiveMad = Math.max(mad, MAD_FLOOR);

  return (value - med) / effectiveMad;
}

export function recordBaselineValue(
  store: BaselineStore,
  sourceId: string,
  metricKey: string,
  value: number,
  fetchedAt: string,
  capacity = RING_BUFFER_CAPACITY,
): void {
  if (!store[sourceId]) {
    store[sourceId] = {
      metrics: {},
      samples: 0,
      lastUpdated: fetchedAt,
    };
  }

  const entry = store[sourceId];
  if (!entry.metrics[metricKey]) {
    entry.metrics[metricKey] = {
      windows: { "1h": [], "4h": [], "24h": [] },
    };
  }

  const observation: BaselineObservation = { value, fetchedAt };
  const metricWindows = entry.metrics[metricKey].windows;

  for (const windowKey of WINDOW_KEYS) {
    metricWindows[windowKey].push(observation);
    while (metricWindows[windowKey].length > capacity) {
      metricWindows[windowKey].shift();
    }
  }

  entry.samples++;
  entry.lastUpdated = fetchedAt;
}

export function getBaselineObservations(
  store: BaselineStore | null,
  sourceId: string,
  metricKey: string,
  window: BaselineWindowKey = "24h",
): BaselineObservation[] {
  if (!store) return [];
  const entry = store[sourceId];
  if (!entry) return [];
  const metric = entry.metrics[metricKey];
  if (!metric) return [];
  return metric.windows[window];
}

export function getBaselineMedian(
  store: BaselineStore | null,
  sourceId: string,
  metricKey: string,
  window: BaselineWindowKey = "24h",
  minSamples = MIN_BASELINE_SAMPLES,
): number | null {
  const observations = getBaselineObservations(store, sourceId, metricKey, window);
  if (observations.length < minSamples) return null;

  const values = observations.map((observation) => observation.value);
  const cleaned = values.length >= 3 ? winsorize(values) : values;
  const sorted = [...cleaned].sort((a, b) => a - b);
  return median(sorted);
}

export function getBaselineSampleCount(
  store: BaselineStore | null,
  sourceId: string,
  metricKey: string,
): number {
  return getBaselineObservations(store, sourceId, metricKey, "24h").length;
}

export function detectChangeAgainstBaseline(
  options: DetectBaselineChangeOptions,
): BaselineChange | null {
  const {
    store,
    sourceId,
    metricKey,
    currentValue,
    threshold,
    window = "24h",
    minSamples = MIN_BASELINE_SAMPLES,
    zScoreThreshold = ZSCORE_THRESHOLD,
  } = options;

  const observations = getBaselineObservations(store, sourceId, metricKey, window);
  if (observations.length < minSamples) return null;

  const baselineValue = getBaselineMedian(store, sourceId, metricKey, window, minSamples);
  if (baselineValue == null || baselineValue === 0) return null;

  const changePercent = ((currentValue - baselineValue) / Math.abs(baselineValue)) * 100;
  const zScore = calculateZScore(currentValue, observations);

  if (zScore !== null && Math.abs(zScore) >= zScoreThreshold) {
    return {
      baselineValue,
      changePercent,
      sampleCount: observations.length,
      zScore,
    };
  }

  if (Math.abs(changePercent) >= threshold) {
    return {
      baselineValue,
      changePercent,
      sampleCount: observations.length,
      zScore,
    };
  }

  return null;
}
