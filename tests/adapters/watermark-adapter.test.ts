import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElizaWatermarkStore } from "../../src/adapters/eliza/watermark-adapter.js";
import type { ElizaDatabaseAdapter, ElizaMemory } from "../../src/adapters/eliza/types.js";

function createMockAdapter(): ElizaDatabaseAdapter & {
  _memories: ElizaMemory[];
} {
  const memories: ElizaMemory[] = [];
  return {
    _memories: memories,
    getMemoriesByRoomIds: vi.fn(async () => [...memories]),
    createMemory: vi.fn(async (memory: ElizaMemory) => {
      memories.push({ ...memory, id: `mem-${Date.now()}-${Math.random()}` });
    }),
    removeMemory: vi.fn(async (memoryId: string) => {
      const idx = memories.findIndex((m) => m.id === memoryId);
      if (idx >= 0) memories.splice(idx, 1);
    }),
  };
}

describe("createElizaWatermarkStore", () => {
  let adapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    adapter = createMockAdapter();
  });

  it("load returns null when no watermark exists", async () => {
    const store = createElizaWatermarkStore(adapter);
    const result = await store.load("feed-source");
    expect(result).toBeNull();
  });

  it("save creates a memory with sourceId and watermark", async () => {
    const store = createElizaWatermarkStore(adapter);
    await store.save("feed-source", { lastId: "abc123" });

    expect(adapter.createMemory).toHaveBeenCalledWith(
      {
        content: { text: "feed-source", watermark: { lastId: "abc123" } },
        roomId: "demos-watermarks-room",
      },
      "demos_watermarks",
    );
  });

  it("load returns saved watermark", async () => {
    const store = createElizaWatermarkStore(adapter);
    await store.save("feed-source", { lastId: "abc123" });

    const result = await store.load("feed-source");
    expect(result).toEqual({ lastId: "abc123" });
  });

  it("save replaces existing watermark for same sourceId", async () => {
    const store = createElizaWatermarkStore(adapter);
    await store.save("feed-source", { lastId: "v1" });
    await store.save("feed-source", { lastId: "v2" });

    expect(adapter.removeMemory).toHaveBeenCalled();
    const result = await store.load("feed-source");
    expect(result).toEqual({ lastId: "v2" });
  });

  it("loadAll returns all stored watermarks", async () => {
    const store = createElizaWatermarkStore(adapter);
    await store.save("source-a", 100);
    await store.save("source-b", 200);

    const all = await store.loadAll();
    expect(all).toEqual({ "source-a": 100, "source-b": 200 });
  });

  it("loadAll returns empty object when no watermarks exist", async () => {
    const store = createElizaWatermarkStore(adapter);
    const all = await store.loadAll();
    expect(all).toEqual({});
  });

  it("load returns null for non-existent sourceId among others", async () => {
    const store = createElizaWatermarkStore(adapter);
    await store.save("source-a", 100);

    const result = await store.load("source-b");
    expect(result).toBeNull();
  });
});
