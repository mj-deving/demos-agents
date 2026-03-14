import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiCallMock } = vi.hoisted(() => ({
  apiCallMock: vi.fn(),
}));

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: apiCallMock,
  info: vi.fn(),
}));

import {
  fetchLatestBriefing,
  fetchSignals,
  scoreSignalAlignment,
  type SignalSnapshot,
  type SignalTopic,
} from "../tools/lib/signals.js";

function makeSignal(overrides: Partial<SignalTopic> = {}): SignalTopic {
  return {
    topic: "bitcoin etf",
    direction: "bullish",
    confidence: 80,
    agentCount: 5,
    evidenceQuality: "strong",
    divergence: false,
    ...overrides,
  };
}

function makeSnapshot(topics: SignalTopic[] = []): SignalSnapshot {
  return {
    fetchedAt: new Date().toISOString(),
    topics,
    alerts: [],
  };
}

describe("fetchSignals", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
  });

  it("returns a normalized snapshot on success", async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          topics: [
            {
              topic: "Bitcoin ETF",
              direction: "invalid",
              confidence: 140,
              agentCount: "4.7",
              evidenceQuality: "unknown",
              divergence: 1,
              staleAt: 123,
            },
          ],
          alerts: [{ topic: "Bitcoin", severity: "high", summary: "watch liquidity" }],
        },
      },
    });

    const snapshot = await fetchSignals("token");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.topics).toHaveLength(1);
    expect(snapshot?.topics[0]).toMatchObject({
      topic: "Bitcoin ETF",
      direction: "neutral",
      confidence: 100,
      agentCount: 4,
      evidenceQuality: "weak",
      divergence: true,
      staleAt: "123",
    });
    expect(snapshot?.alerts).toEqual([
      { topic: "Bitcoin", severity: "high", summary: "watch liquidity" },
    ]);
  });

  it("returns null on HTTP failure", async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 503, data: { error: "down" } });

    await expect(fetchSignals("token")).resolves.toBeNull();
  });

  it("returns null on malformed responses", async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, data: { unexpected: true } });

    await expect(fetchSignals("token")).resolves.toBeNull();
  });
});

describe("scoreSignalAlignment", () => {
  it("returns 0 for an empty snapshot", () => {
    expect(scoreSignalAlignment("bitcoin", makeSnapshot(), "sentinel")).toBe(0);
  });

  it("rewards sentinel mode for strong matching signals", () => {
    const snapshot = makeSnapshot([makeSignal({ topic: "Bitcoin ETF approval", evidenceQuality: "strong" })]);

    expect(scoreSignalAlignment("ETF approval for bitcoin", snapshot, "sentinel")).toBe(5);
  });

  it("rewards pioneer mode for divergent or low-coverage matches", () => {
    const snapshot = makeSnapshot([makeSignal({ topic: "Bitcoin ETF", divergence: true, agentCount: 1 })]);

    expect(scoreSignalAlignment("bitcoin etf", snapshot, "pioneer")).toBe(5);
  });

  it("keeps crawler mode neutral", () => {
    const snapshot = makeSnapshot([makeSignal()]);

    expect(scoreSignalAlignment("bitcoin etf", snapshot, "crawler")).toBe(0);
  });

  it("returns 0 when no topic tokens overlap", () => {
    const snapshot = makeSnapshot([makeSignal({ topic: "ethereum scaling" })]);

    expect(scoreSignalAlignment("quantum networking", snapshot, "sentinel")).toBe(0);
  });
});

describe("fetchLatestBriefing", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
  });

  it("returns the latest summary on success", async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: { summary: "Network risk is rising." } },
    });

    await expect(fetchLatestBriefing("token")).resolves.toBe("Network risk is rising.");
  });

  it("returns null on failure", async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, data: {} });

    await expect(fetchLatestBriefing("token")).resolves.toBeNull();
  });
});
