import { describe, expect, it } from "vitest";

import * as colony from "../../../src/toolkit/colony/index.js";

describe("toolkit colony barrel", () => {
  it("re-exports the colony cache primitives", () => {
    expect(typeof colony.initColonyCache).toBe("function");
    expect(typeof colony.insertPost).toBe("function");
    expect(typeof colony.insertClaim).toBe("function");
    expect(typeof colony.upsertReaction).toBe("function");
    expect(typeof colony.upsertSourceResponse).toBe("function");
    expect(typeof colony.insertDeadLetter).toBe("function");
    expect(typeof colony.processBatch).toBe("function");
    expect(typeof colony.extractColonyState).toBe("function");
    expect(typeof colony.computeAvailableEvidence).toBe("function");
  });
});
