import { describe, expect, it, vi } from "vitest";

import { verifyPublishVisibility } from "../../packages/omniweb-toolkit/src/publish-visibility";

describe("verifyPublishVisibility", () => {
  it("keeps polling after chain visibility and returns indexed visibility when post detail catches up", async () => {
    let now = 0;
    let postDetailCalls = 0;
    const getFeed = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        posts: [],
        meta: { lastBlock: 123 },
      },
    });
    const getPostDetail = vi.fn().mockImplementation(async () => {
      postDetailCalls += 1;
      if (postDetailCalls < 3) {
        return { ok: false, status: 404, error: "not_found" };
      }
      return {
        ok: true,
        data: {
          post: {
            txHash: "tx-1",
            blockNumber: 77,
            payload: { cat: "OBSERVATION" },
          },
        },
      };
    });
    const getHivePosts = vi.fn().mockResolvedValue([
      { txHash: "tx-1", blockNumber: 77, category: "OBSERVATION", text: "hello world" },
    ]);

    const result = await verifyPublishVisibility(
      {
        colony: { getFeed, getPostDetail },
        runtime: { sdkBridge: { getHivePosts } },
      },
      "tx-1",
      "hello world",
      {
        timeoutMs: 10_000,
        pollMs: 1_000,
        limit: 20,
        now: () => now,
        sleep: async (ms) => { now += ms; },
      },
    );

    expect(result).toMatchObject({
      visible: true,
      indexedVisible: true,
      verificationPath: "post_detail",
      txHash: "tx-1",
      observedBlockNumber: 77,
    });
    expect(getHivePosts).toHaveBeenCalledTimes(2);
    expect(getPostDetail).toHaveBeenCalledTimes(3);
  });

  it("returns a chain-only result after the deadline if indexing never catches up", async () => {
    let now = 0;
    const result = await verifyPublishVisibility(
      {
        colony: {
          getFeed: vi.fn().mockResolvedValue({
            ok: true,
            data: { posts: [], meta: { lastBlock: 222 } },
          }),
          getPostDetail: vi.fn().mockResolvedValue({ ok: false, status: 404, error: "not_found" }),
        },
        runtime: {
          sdkBridge: {
            getHivePosts: vi.fn().mockResolvedValue([
              { txHash: "tx-2", blockNumber: 88, category: "ANALYSIS", text: "indexed later" },
            ]),
          },
        },
      },
      "tx-2",
      "indexed later",
      {
        timeoutMs: 3_000,
        pollMs: 1_000,
        limit: 20,
        now: () => now,
        sleep: async (ms) => { now += ms; },
      },
    );

    expect(result).toMatchObject({
      visible: true,
      indexedVisible: false,
      verificationPath: "chain",
      txHash: "tx-2",
      observedBlockNumber: 88,
      lastIndexedBlock: 222,
      error: "not_found",
    });
  });
});
