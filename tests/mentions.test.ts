import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const { apiCallMock } = vi.hoisted(() => ({
  apiCallMock: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/tmp/omniweb-agents-tests-mentions",
}));

vi.mock("../src/lib/network/sdk.js", () => ({
  apiCall: apiCallMock,
  info: vi.fn(),
}));

import {
  fetchMentions,
  loadMentionState,
  saveMentionState,
} from "../src/lib/mentions.js";

describe("fetchMentions", () => {
  beforeEach(() => {
    apiCallMock.mockReset();
    rmSync("/tmp/omniweb-agents-tests-mentions", { recursive: true, force: true });
  });

  it("filters by agent address and respects the cursor", async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        posts: [
          {
            txHash: "older",
            author: "0xolder",
            timestamp: 99,
            payload: { mentions: ["0xagent"], text: "old mention" },
          },
          {
            txHash: "cursor",
            author: "0xcursor",
            timestamp: 100,
            payload: { mentions: ["0xagent"], text: "same item" },
          },
          {
            txHash: "same-ts-new",
            author: "0xnew",
            timestamp: 100,
            payload: { mentions: ["0xAGENT", "0xother"], text: "same timestamp, new tx" },
          },
          {
            txHash: "later",
            author: "0xlater",
            timestamp: 101,
            payload: { mentions: ["0xagent"], text: "later mention" },
          },
          {
            txHash: "other-agent",
            author: "0xskip",
            timestamp: 102,
            payload: { mentions: ["0xelse"], text: "not ours" },
          },
        ],
      },
    });

    const mentions = await fetchMentions("0xagent", "token", {
      limit: 50,
      cursor: { txHash: "cursor", timestamp: 100 },
    });

    expect(apiCallMock).toHaveBeenCalledWith("/api/feed?limit=50", "token");
    expect(mentions).toEqual([
      {
        txHash: "same-ts-new",
        author: "0xnew",
        timestamp: 100,
        textPreview: "same timestamp, new tx",
        mentions: ["0xagent", "0xother"],
      },
      {
        txHash: "later",
        author: "0xlater",
        timestamp: 101,
        textPreview: "later mention",
        mentions: ["0xagent"],
      },
    ]);
  });

  it("returns an empty list for an empty feed", async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, data: { posts: [] } });

    await expect(fetchMentions("0xagent", "token")).resolves.toEqual([]);
  });
});

describe("mention state", () => {
  beforeEach(() => {
    rmSync("/tmp/omniweb-agents-tests-mentions", { recursive: true, force: true });
  });

  it("loads fresh state and round-trips saved cursors", () => {
    expect(loadMentionState("oracle")).toEqual({ lastProcessedMention: null });

    const state = {
      lastProcessedMention: {
        txHash: "tx-123",
        timestamp: 456,
      },
    };
    saveMentionState(state, "oracle");

    const path = resolve("/tmp/omniweb-agents-tests-mentions", ".oracle", "mentions-state.json");
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(state);
    expect(loadMentionState("oracle")).toEqual(state);
  });
});
