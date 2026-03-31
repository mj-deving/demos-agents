import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getClaimsByPost } from "../../../src/toolkit/colony/claims.js";
import { getPost } from "../../../src/toolkit/colony/posts.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import { decodeHiveData, extractMentions, processBatch, retryDeadLetters } from "../../../src/toolkit/colony/scanner.js";

describe("colony scanner", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("decodes hive post data and extracts mentions", () => {
    const decoded = decodeHiveData(JSON.stringify({
      v: 1,
      text: "@Demos1Scout Bitcoin hash rate is 877.9 EH/s",
      tags: ["Bitcoin", "Mining"],
      replyTo: "0xroot-1",
      sourceAttestations: [{
        txHash: "0xatt-1",
        url: "https://data.example.com/btc",
        method: "TLSN",
        dataSnapshot: { bitcoin: true, hash_rate: 877.9 },
      }],
    }));

    expect(decoded).toMatchObject({
      text: "@Demos1Scout Bitcoin hash rate is 877.9 EH/s",
      tags: ["bitcoin", "mining"],
      replyTo: "0xroot-1",
      attestations: [{
        txHash: "0xatt-1",
        url: "https://data.example.com/btc",
        method: "TLSN",
        dataSnapshot: { bitcoin: true, hash_rate: 877.9 },
      }],
    });
    expect(extractMentions("Ping @Demos1Scout and @market-bot about @Demos1Scout")).toEqual([
      "demos1scout",
      "market-bot",
    ]);
  });

  it("processes posts, indexes claims, and dead-letters decode failures", () => {
    const result = processBatch(db, [
      {
        txHash: "0xpost-1",
        author: "demos1alice",
        blockNumber: 101,
        timestamp: "2026-03-31T10:00:00.000Z",
        data: JSON.stringify({
          v: 1,
          text: "Bitcoin hash rate is 877.9 EH/s and climbing.",
          tags: ["bitcoin", "mining"],
          sourceAttestations: [{
            txHash: "0xatt-1",
            url: "https://data.example.com/btc",
            method: "DAHR",
            dataSnapshot: { bitcoin: true, hash_rate: 877.9 },
          }],
        }),
      },
      {
        txHash: "0xpost-bad",
        author: "demos1bob",
        blockNumber: 102,
        timestamp: "2026-03-31T10:05:00.000Z",
        data: "not-json",
      },
    ]);

    expect(result).toMatchObject({
      newPostCount: 1,
      totalCached: 1,
      cursor: 102,
      deadLetterCount: 1,
      claimsExtracted: 1,
    });

    expect(getPost(db, "0xpost-1")).toMatchObject({
      author: "demos1alice",
      tags: ["bitcoin", "mining"],
      text: "Bitcoin hash rate is 877.9 EH/s and climbing.",
    });

    const claims = getClaimsByPost(db, "0xpost-1");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      subject: "bitcoin",
      metric: "hash_rate",
      value: 877.9,
      attestationTxHash: "0xatt-1",
      verified: true,
    });

    const attestationRows = db.prepare(`
      SELECT attestation_tx_hash, method, data_snapshot
      FROM attestations
      WHERE post_tx_hash = ?
    `).all("0xpost-1") as Array<{ attestation_tx_hash: string; method: string; data_snapshot: string | null }>;

    expect(attestationRows).toEqual([{
      attestation_tx_hash: "0xatt-1",
      method: "DAHR",
      data_snapshot: "{\"bitcoin\":true,\"hash_rate\":877.9}",
    }]);
  });

  it("retries dead letters when the stored raw post envelope is decodable", () => {
    db.prepare(`
      INSERT INTO dead_letters (tx_hash, raw_payload, block_number, error, retry_count, first_failed_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      "0xdead-1",
      JSON.stringify({
        txHash: "0xdead-1",
        author: "demos1carol",
        blockNumber: 150,
        timestamp: "2026-03-31T12:00:00.000Z",
        data: JSON.stringify({
          v: 1,
          text: "Bitcoin supply is 21 BTC",
          tags: ["bitcoin"],
          sourceAttestations: [{
            txHash: "0xatt-2",
            url: "https://data.example.com/supply",
            method: "TLSN",
            dataSnapshot: { bitcoin: true, totalSupply: 21 },
          }],
        }),
      }),
      150,
      "transient decode failure",
      "2026-03-31T12:01:00.000Z",
    );

    expect(retryDeadLetters(db)).toBe(1);
    expect(getPost(db, "0xdead-1")).toMatchObject({
      author: "demos1carol",
      text: "Bitcoin supply is 21 BTC",
    });
    expect(getClaimsByPost(db, "0xdead-1")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) FROM dead_letters").pluck().get()).toBe(0);
  });
});
