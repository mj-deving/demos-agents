import { beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

const { apiCallMock } = vi.hoisted(() => ({
  apiCallMock: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/tmp/demos-agents-tests-tips",
}));

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: apiCallMock,
  info: vi.fn(),
}));

import { loadTipState, selectTipCandidates } from "../tools/lib/tips.js";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    topics: {
      primary: ["bitcoin"],
      secondary: ["etf"],
    },
    tipping: {
      enabled: true,
      maxTipsPerSession: 5,
      maxPerRecipientPerDay: 1,
      minMinutesBetweenTips: 30,
      minSessionsBeforeLive: 0,
      minScore: 70,
      requireAttestation: true,
      ...(overrides.tipping as Record<string, unknown> | undefined),
    },
    ...overrides,
  } as any;
}

function rawPost(overrides: Record<string, unknown> = {}) {
  const payload = (overrides.payload as Record<string, unknown> | undefined) || {};
  return {
    txHash: "tx-1",
    author: "0xauthor",
    timestamp: 1_710_410_400,
    score: 90,
    reactions: { agree: 10, disagree: 0 },
    payload: {
      cat: "analysis",
      tags: ["bitcoin"],
      assets: ["BTC"],
      text: "Bitcoin ETF momentum keeps building.",
      sourceAttestations: [{ id: "att-1" }],
      ...payload,
    },
    ...overrides,
  };
}

describe("selectTipCandidates", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
    rmSync("/tmp/demos-agents-tests-tips", { recursive: true, force: true });
  });

  it("filters self-tips, already tipped posts, recipient caps, attestation requirements, and low scores", () => {
    const now = new Date("2026-03-14T12:00:00.000Z");
    const today = now.toISOString().slice(0, 10);
    const candidates = selectTipCandidates(
      [
        rawPost({ txHash: "ok", author: "0xgood", score: 88 }),
        rawPost({ txHash: "self", author: "0xagent" }),
        rawPost({ txHash: "tipped", author: "0xother" }),
        rawPost({ txHash: "cap", author: "0xcap" }),
        rawPost({ txHash: "no-attest", author: "0xplain", payload: { sourceAttestations: [] } }),
        rawPost({ txHash: "low-score", author: "0xlow", score: 65 }),
      ],
      {
        agentAddress: "0xagent",
        config: baseConfig(),
        tipState: {
          tippedPosts: ["tipped"],
          perRecipientCounts: {
            "0xcap": { date: today, count: 1 },
          },
          lastTipTimestamp: null,
          warmupCounter: 0,
        },
        now,
      }
    );

    expect(candidates.map((candidate) => candidate.txHash)).toEqual(["ok"]);
  });

  it("enforces the cooldown window", () => {
    const now = new Date("2026-03-14T12:00:00.000Z");
    const candidates = selectTipCandidates(
      [rawPost({ txHash: "cooldown-ok" })],
      {
        agentAddress: "0xagent",
        config: baseConfig(),
        tipState: {
          tippedPosts: [],
          perRecipientCounts: {},
          lastTipTimestamp: "2026-03-14T11:50:00.000Z",
          warmupCounter: 0,
        },
        now,
      }
    );

    expect(candidates).toEqual([]);
  });

  it("computes the max tip amount for high score and strong reactions", () => {
    const [candidate] = selectTipCandidates(
      [rawPost({ txHash: "big", score: 96, reactions: { agree: 15, disagree: 0 } })],
      {
        agentAddress: "0xagent",
        config: baseConfig(),
        tipState: { tippedPosts: [], perRecipientCounts: {}, lastTipTimestamp: null, warmupCounter: 0 },
      }
    );

    expect(candidate.amount).toBe(3);
  });

  it("computes smaller tip amounts when only one or neither bonus applies", () => {
    const [mid] = selectTipCandidates(
      [rawPost({ txHash: "mid", score: 96, reactions: { agree: 2, disagree: 0 } })],
      {
        agentAddress: "0xagent",
        config: baseConfig(),
        tipState: { tippedPosts: [], perRecipientCounts: {}, lastTipTimestamp: null, warmupCounter: 0 },
      }
    );
    const [base] = selectTipCandidates(
      [rawPost({ txHash: "base", score: 80, reactions: { agree: 2, disagree: 0 } })],
      {
        agentAddress: "0xagent",
        config: baseConfig(),
        tipState: { tippedPosts: [], perRecipientCounts: {}, lastTipTimestamp: null, warmupCounter: 0 },
      }
    );

    expect(mid.amount).toBe(2);
    expect(base.amount).toBe(1);
  });
});

describe("loadTipState", () => {
  beforeEach(() => {
    rmSync("/tmp/demos-agents-tests-tips", { recursive: true, force: true });
  });

  it("returns a fresh state when the file is missing", () => {
    expect(loadTipState("oracle")).toEqual({
      tippedPosts: [],
      perRecipientCounts: {},
      lastTipTimestamp: null,
      warmupCounter: 0,
    });
  });
});
