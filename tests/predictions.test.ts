import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PublishedPostRecord } from "../src/lib/state.js";

const { apiCallMock } = vi.hoisted(() => ({
  apiCallMock: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/tmp/omniweb-agents-tests-predictions",
}));

vi.mock("../src/lib/network/sdk.js", () => ({
  apiCall: apiCallMock,
  info: vi.fn(),
}));

import {
  getCalibrationAdjustment,
  loadPredictions,
  registerPrediction,
  resolvePendingPredictions,
  type PredictionStore,
} from "../src/lib/predictions.js";

function makePost(overrides: Partial<PublishedPostRecord> = {}): PublishedPostRecord {
  return {
    txHash: "tx-1",
    topic: "bitcoin",
    category: "PREDICTION",
    text: "Bitcoin could rise above $50K by March 2026.",
    confidence: 82,
    predictedReactions: 7,
    tags: ["bitcoin"],
    publishedAt: "2026-03-01T00:00:00.000Z",
    attestationType: "DAHR",
    ...overrides,
  };
}

function makeStore(overrides: Partial<PredictionStore> = {}): PredictionStore {
  return {
    version: 1,
    agent: "oracle",
    updatedAt: new Date().toISOString(),
    predictions: {},
    ...overrides,
  };
}

describe("loadPredictions", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
    rmSync("/tmp/omniweb-agents-tests-predictions", { recursive: true, force: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty store when the file is missing", () => {
    const store = loadPredictions("oracle");

    expect(store).toMatchObject({
      version: 1,
      agent: "oracle",
      predictions: {},
    });
  });

  it("returns an empty store when the file is corrupt", () => {
    const dir = resolve("/tmp/omniweb-agents-tests-predictions", ".oracle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "predictions.json"), "{not-json");

    const store = loadPredictions("oracle");

    expect(store).toMatchObject({
      version: 1,
      agent: "oracle",
      predictions: {},
    });
  });
});

describe("registerPrediction", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
  });

  it("registers only PREDICTION posts", () => {
    const store = registerPrediction(makeStore(), makePost());

    expect(Object.keys(store.predictions)).toEqual(["tx-1"]);
    expect(store.predictions["tx-1"]).toMatchObject({
      predictedValue: "$50K",
      predictedDirection: "up",
      deadline: "March 2026",
      manualReviewRequired: false,
      status: "pending",
    });
  });

  it("is idempotent for duplicate tx hashes", () => {
    const store = makeStore();

    registerPrediction(store, makePost());
    registerPrediction(store, makePost());

    expect(Object.keys(store.predictions)).toHaveLength(1);
  });

  it("skips non-PREDICTION posts", () => {
    const store = registerPrediction(
      makeStore(),
      makePost({ txHash: "tx-2", category: "ANALYSIS", text: "Observation only." })
    );

    expect(store.predictions).toEqual({});
  });
});

describe("getCalibrationAdjustment", () => {
  it("returns 0 when there is insufficient resolved data", () => {
    const store = makeStore({
      predictions: {
        a: { ...makePost({ txHash: "a" }), status: "correct", agent: "oracle", manualReviewRequired: false },
        b: { ...makePost({ txHash: "b" }), status: "incorrect", agent: "oracle", manualReviewRequired: false },
      },
    });

    expect(getCalibrationAdjustment(store)).toBe(0);
  });

  it("returns +1 when accuracy is mostly correct", () => {
    const store = makeStore({
      predictions: {
        a: { ...makePost({ txHash: "a" }), status: "correct", agent: "oracle", manualReviewRequired: false },
        b: { ...makePost({ txHash: "b" }), status: "correct", agent: "oracle", manualReviewRequired: false },
        c: { ...makePost({ txHash: "c" }), status: "correct", agent: "oracle", manualReviewRequired: false },
        d: { ...makePost({ txHash: "d" }), status: "correct", agent: "oracle", manualReviewRequired: false },
        e: { ...makePost({ txHash: "e" }), status: "incorrect", agent: "oracle", manualReviewRequired: false },
      },
    });

    expect(getCalibrationAdjustment(store)).toBe(1);
  });

  it("returns -1 when accuracy is mostly incorrect", () => {
    const store = makeStore({
      predictions: {
        a: { ...makePost({ txHash: "a" }), status: "incorrect", agent: "oracle", manualReviewRequired: false },
        b: { ...makePost({ txHash: "b" }), status: "incorrect", agent: "oracle", manualReviewRequired: false },
        c: { ...makePost({ txHash: "c" }), status: "incorrect", agent: "oracle", manualReviewRequired: false },
        d: { ...makePost({ txHash: "d" }), status: "incorrect", agent: "oracle", manualReviewRequired: false },
        e: { ...makePost({ txHash: "e" }), status: "correct", agent: "oracle", manualReviewRequired: false },
      },
    });

    expect(getCalibrationAdjustment(store)).toBe(-1);
  });
});

describe("resolvePendingPredictions", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
    apiCallMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires quarter and month deadlines while leaving future and invalid ones pending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00.000Z"));

    const store = makeStore({
      predictions: {
        q1: {
          ...makePost({ txHash: "q1" }),
          status: "pending",
          agent: "oracle",
          deadline: "Q1 2026",
          manualReviewRequired: false,
        },
        march: {
          ...makePost({ txHash: "march" }),
          status: "pending",
          agent: "oracle",
          deadline: "March 2026",
          manualReviewRequired: false,
        },
        eoy: {
          ...makePost({ txHash: "eoy" }),
          status: "pending",
          agent: "oracle",
          deadline: "EOY 2026",
          manualReviewRequired: false,
        },
        unknown: {
          ...makePost({ txHash: "unknown" }),
          status: "pending",
          agent: "oracle",
          deadline: "sometime later",
          manualReviewRequired: false,
        },
      },
    });

    const updated = await resolvePendingPredictions(store, "token");

    expect(updated.predictions.q1.status).toBe("expired");
    expect(updated.predictions.march.status).toBe("expired");
    expect(updated.predictions.eoy.status).toBe("pending");
    expect(updated.predictions.unknown.status).toBe("pending");
    expect(apiCallMock).toHaveBeenCalledTimes(2);
    expect(apiCallMock).toHaveBeenNthCalledWith(
      1,
      "/api/predictions/q1/resolve",
      "token",
      expect.objectContaining({ method: "POST" })
    );
  });
});
