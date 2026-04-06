import { describe, it, expect, vi } from "vitest";
import { backfillFromApi } from "../../../src/toolkit/colony/api-backfill.js";
import type { SuperColonyApiClient } from "../../../src/toolkit/supercolony/api-client.js";

function mockClient(pages: Array<{ posts: any[]; hasMore: boolean }>): SuperColonyApiClient {
  const getFeed = vi.fn();
  for (const page of pages) {
    getFeed.mockResolvedValueOnce({ ok: true, data: page });
  }
  return { getFeed } as unknown as SuperColonyApiClient;
}

function makePost(txHash: string) {
  return {
    txHash,
    author: "0xa1",
    timestamp: 1700000000000,
    payload: { cat: "ANALYSIS", text: `Post ${txHash}`, tags: [] },
    blockNumber: 100,
    reactions: { agree: 5, disagree: 0 },
  };
}

const mockDb = {
  prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
} as any;

vi.mock("../../../src/toolkit/colony/posts.js", () => ({
  insertPost: vi.fn(),
}));

describe("backfillFromApi", () => {
  it("fetches and inserts posts from API", async () => {
    const client = mockClient([
      { posts: [makePost("0x1"), makePost("0x2")], hasMore: true },
      { posts: [makePost("0x3")], hasMore: false },
    ]);

    const stats = await backfillFromApi(mockDb, client, { limit: 100 });

    expect(stats.fetched).toBe(3);
    expect(stats.inserted).toBe(3);
    expect(stats.pages).toBe(2);
    expect(client.getFeed).toHaveBeenCalledTimes(2);
  });

  it("respects limit", async () => {
    const client = mockClient([
      { posts: [makePost("0x1"), makePost("0x2")], hasMore: true },
    ]);

    const stats = await backfillFromApi(mockDb, client, { limit: 2, batchSize: 2 });

    expect(stats.fetched).toBe(2);
    expect(client.getFeed).toHaveBeenCalledTimes(1);
  });

  it("stops when API returns null", async () => {
    const client = { getFeed: vi.fn().mockResolvedValue(null) } as unknown as SuperColonyApiClient;

    const stats = await backfillFromApi(mockDb, client, { limit: 100 });

    expect(stats.fetched).toBe(0);
    expect(stats.pages).toBe(0);
  });

  it("calls onProgress callback", async () => {
    const client = mockClient([
      { posts: [makePost("0x1")], hasMore: false },
    ]);
    const onProgress = vi.fn();

    await backfillFromApi(mockDb, client, { limit: 100, onProgress });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ fetched: 1, pages: 1 }));
  });
});
