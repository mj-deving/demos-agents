import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteDeadLetter, getRetryable, incrementRetry, insertDeadLetter } from "../../../src/toolkit/colony/dead-letters.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";

describe("colony dead letters", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("inserts retryable records and increments retries", () => {
    insertDeadLetter(db, "0xdead-1", "{\"broken\":true}", 99, "decode failed");
    insertDeadLetter(db, "0xdead-2", "{\"broken\":true}", 100, "decode failed");

    expect(getRetryable(db).map((entry) => entry.txHash)).toEqual(["0xdead-1", "0xdead-2"]);

    incrementRetry(db, "0xdead-1");
    incrementRetry(db, "0xdead-1");

    expect(getRetryable(db, 2).map((entry) => entry.txHash)).toEqual(["0xdead-2"]);
  });

  it("deletes recovered dead letters", () => {
    insertDeadLetter(db, "0xdead-1", "{\"broken\":true}", 99, "decode failed");

    deleteDeadLetter(db, "0xdead-1");

    expect(getRetryable(db)).toEqual([]);
  });
});
