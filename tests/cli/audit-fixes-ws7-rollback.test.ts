/**
 * Audit fixes WS7 — H2: ID-based rollback for write-rate-limit.
 *
 * Tests that rollbackWriteRecord removes a specific timestamp entry,
 * not just pop() which is unsafe for concurrent publishers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStateStore } from "../../src/toolkit/state-store.js";
import {
  checkAndRecordWrite,
  rollbackWriteRecord,
  getWriteRateRemaining,
} from "../../src/toolkit/guards/write-rate-limit.js";

describe("H2: ID-based rollback for write-rate-limit", () => {
  let tempDir: string;
  let store: FileStateStore;
  const WALLET = "demos1testaddr";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-rollback-"));
    store = new FileStateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("checkAndRecordWrite returns the recorded timestamp when record=true", async () => {
    const result = await checkAndRecordWrite(store, WALLET, true);
    expect(result.error).toBeNull();
    expect(result.recordedTimestamp).toBeTypeOf("number");
    expect(result.recordedTimestamp).toBeGreaterThan(0);
  });

  it("checkAndRecordWrite returns null timestamp when record=false", async () => {
    const result = await checkAndRecordWrite(store, WALLET, false);
    expect(result.error).toBeNull();
    expect(result.recordedTimestamp).toBeNull();
  });

  it("rollbackWriteRecord removes only the specific timestamp", async () => {
    const first = await checkAndRecordWrite(store, WALLET, true);
    const second = await checkAndRecordWrite(store, WALLET, true);

    expect(first.recordedTimestamp).not.toBeNull();
    expect(second.recordedTimestamp).not.toBeNull();

    // Rollback the first one
    await rollbackWriteRecord(store, WALLET, first.recordedTimestamp!);

    // Only one entry should remain
    const remaining = await getWriteRateRemaining(store, WALLET);
    expect(remaining.dailyRemaining).toBe(13); // 14 - 1 = 13
    expect(remaining.hourlyRemaining).toBe(4); // 5 - 1 = 4
  });

  it("concurrent rollback: two reservations, one rolled back, other stays", async () => {
    const reservationA = await checkAndRecordWrite(store, WALLET, true);
    const reservationB = await checkAndRecordWrite(store, WALLET, true);

    expect(reservationA.recordedTimestamp).not.toBeNull();
    expect(reservationB.recordedTimestamp).not.toBeNull();

    // Publisher A fails -- rollback its reservation
    await rollbackWriteRecord(store, WALLET, reservationA.recordedTimestamp!);

    // Publisher B's reservation must still be there
    const remaining = await getWriteRateRemaining(store, WALLET);
    expect(remaining.dailyRemaining).toBe(13); // only 1 entry remains
    expect(remaining.hourlyRemaining).toBe(4);
  });

  it("rollback is idempotent -- rolling back same timestamp twice is safe", async () => {
    const reservation = await checkAndRecordWrite(store, WALLET, true);
    expect(reservation.recordedTimestamp).not.toBeNull();

    await rollbackWriteRecord(store, WALLET, reservation.recordedTimestamp!);
    await rollbackWriteRecord(store, WALLET, reservation.recordedTimestamp!);

    const remaining = await getWriteRateRemaining(store, WALLET);
    expect(remaining.dailyRemaining).toBe(14);
    expect(remaining.hourlyRemaining).toBe(5);
  });

  it("rollback with non-existent timestamp does not remove anything", async () => {
    await checkAndRecordWrite(store, WALLET, true);

    await rollbackWriteRecord(store, WALLET, 9999999999999);

    const remaining = await getWriteRateRemaining(store, WALLET);
    expect(remaining.dailyRemaining).toBe(13);
    expect(remaining.hourlyRemaining).toBe(4);
  });

  it("handles rollback on empty state gracefully", async () => {
    // No entries recorded -- rollback should not throw
    await rollbackWriteRecord(store, WALLET, 1700000000000);

    const remaining = await getWriteRateRemaining(store, WALLET);
    expect(remaining.dailyRemaining).toBe(14);
    expect(remaining.hourlyRemaining).toBe(5);
  });
});
