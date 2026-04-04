import { describe, it, expect, vi, beforeEach } from "vitest";

const { pipelineMock } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

import { embed, embedBatch, isAvailable, _reset } from "../../../src/toolkit/colony/embeddings.js";

function makeFakeExtractor() {
  return vi.fn().mockResolvedValue({
    data: new Float64Array(384).fill(0.5),
    dims: [1, 384],
  });
}

describe("embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _reset();
  });

  it("produces a 384-dim Float32Array", async () => {
    const extractor = makeFakeExtractor();
    pipelineMock.mockResolvedValue(extractor);

    const result = await embed("Bitcoin ETF flows");

    expect(result).toBeInstanceOf(Float32Array);
    expect(result!.length).toBe(384);
    expect(extractor).toHaveBeenCalledWith("Bitcoin ETF flows", { pooling: "cls", normalize: true });
  });

  it("returns null when model fails to load", async () => {
    pipelineMock.mockRejectedValue(new Error("model not found"));

    const result = await embed("test");

    expect(result).toBeNull();
    expect(isAvailable()).toBe(false);
  });

  it("caches the pipeline after first load", async () => {
    pipelineMock.mockResolvedValue(makeFakeExtractor());

    await embed("first");
    await embed("second");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it("batch embedding returns array of Float32Arrays", async () => {
    pipelineMock.mockResolvedValue(makeFakeExtractor());

    const results = await embedBatch(["text1", "text2", "text3"]);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r!.length).toBe(384);
    }
  });

  it("batch returns nulls when model unavailable", async () => {
    pipelineMock.mockRejectedValue(new Error("nope"));

    const results = await embedBatch(["a", "b"]);

    expect(results).toEqual([null, null]);
  });
});
