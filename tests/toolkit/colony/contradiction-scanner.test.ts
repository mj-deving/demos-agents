import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanForContradictions, METRIC_WINDOWS } from "../../../src/toolkit/colony/contradiction-scanner.js";
import { initColonyCache, type ColonyDatabase } from "../../../src/toolkit/colony/schema.js";
import { insertPost } from "../../../src/toolkit/colony/posts.js";
import { insertClaim } from "../../../src/toolkit/colony/claims.js";

function createTestDb(): ColonyDatabase {
  return initColonyCache(":memory:");
}

function addPost(db: ColonyDatabase, txHash: string, author: string) {
  insertPost(db, {
    txHash, author, blockNumber: 1,
    timestamp: new Date().toISOString(),
    replyTo: null, tags: [], text: "Test", rawData: {},
  });
}

function addClaim(
  db: ColonyDatabase,
  opts: { subject: string; metric: string; value: number | null; author: string; postTxHash: string; claimedAt?: string; verified?: boolean },
) {
  insertClaim(db, {
    subject: opts.subject,
    metric: opts.metric,
    value: opts.value,
    unit: "USD",
    direction: null,
    chain: "eth:1",
    address: null,
    market: null,
    entityId: null,
    dataTimestamp: null,
    postTxHash: opts.postTxHash,
    author: opts.author,
    claimedAt: opts.claimedAt ?? new Date().toISOString(),
    attestationTxHash: null,
    verified: opts.verified ?? false,
    verificationResult: null,
    stale: false,
  });
}

const OUR_ADDRESS = "0xOurAgent";
const SINCE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe("scanForContradictions", () => {
  let db: ColonyDatabase;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it("returns empty for no claims", () => {
    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result).toEqual([]);
  });

  it("returns empty for unanimous claims (same value)", () => {
    addPost(db, "0xP1", "0xAgent1");
    addPost(db, "0xP2", "0xAgent2");
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: "0xAgent1", postTxHash: "0xP1" });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: "0xAgent2", postTxHash: "0xP2" });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result).toEqual([]);
  });

  it("detects contradiction between two agents", () => {
    addPost(db, "0xP1", "0xAgent1");
    addPost(db, "0xP2", "0xAgent2");
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: "0xAgent1", postTxHash: "0xP1" });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 200, author: "0xAgent2", postTxHash: "0xP2" });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("bitcoin");
    expect(result[0].metric).toBe("price");
    expect(result[0].claims).toHaveLength(2);
    expect(result[0].targetPostTxHash).toBeTruthy();
  });

  it("skips same-author updates (not a contradiction)", () => {
    addPost(db, "0xP1", "0xAgent1");
    addPost(db, "0xP2", "0xAgent1");
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: "0xAgent1", postTxHash: "0xP1" });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 200, author: "0xAgent1", postTxHash: "0xP2" });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result).toEqual([]);
  });

  it("self-exclusion: skips contradictions where only our claims exist", () => {
    addPost(db, "0xP1", OUR_ADDRESS);
    addPost(db, "0xP2", OUR_ADDRESS);
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: OUR_ADDRESS, postTxHash: "0xP1" });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 200, author: OUR_ADDRESS, postTxHash: "0xP2" });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result).toEqual([]);
  });

  it("respects maxResults cap", () => {
    // Create 5 contradictions
    for (let i = 0; i < 5; i++) {
      addPost(db, `0xP${i}a`, "0xAgent1");
      addPost(db, `0xP${i}b`, "0xAgent2");
      addClaim(db, { subject: `asset${i}`, metric: "price", value: 100, author: "0xAgent1", postTxHash: `0xP${i}a` });
      addClaim(db, { subject: `asset${i}`, metric: "price", value: 200, author: "0xAgent2", postTxHash: `0xP${i}b` });
    }

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS, maxResults: 2 });
    expect(result).toHaveLength(2);
  });

  it("selects newest post by different author as target", () => {
    addPost(db, "0xOld", "0xAgent1");
    addPost(db, "0xNew", "0xAgent2");
    const oldTime = new Date(Date.now() - 1000).toISOString();
    const newTime = new Date().toISOString();
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: "0xAgent1", postTxHash: "0xOld", claimedAt: oldTime });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 200, author: "0xAgent2", postTxHash: "0xNew", claimedAt: newTime });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result[0].targetPostTxHash).toBe("0xNew");
  });

  it("includes our supported value when we have a verified claim", () => {
    addPost(db, "0xP1", OUR_ADDRESS);
    addPost(db, "0xP2", "0xAgent2");
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: OUR_ADDRESS, postTxHash: "0xP1", verified: true });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 200, author: "0xAgent2", postTxHash: "0xP2" });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result[0].supportedValue).toBe(100);
    expect(result[0].targetPostTxHash).toBe("0xP2");
  });

  it("returns null supportedValue when we have no claim", () => {
    addPost(db, "0xP1", "0xAgent1");
    addPost(db, "0xP2", "0xAgent2");
    addClaim(db, { subject: "bitcoin", metric: "price", value: 100, author: "0xAgent1", postTxHash: "0xP1" });
    addClaim(db, { subject: "bitcoin", metric: "price", value: 200, author: "0xAgent2", postTxHash: "0xP2" });

    const result = scanForContradictions(db, { since: SINCE, ourAddress: OUR_ADDRESS });
    expect(result[0].supportedValue).toBeNull();
  });

  it("uses correct metric windows", () => {
    expect(METRIC_WINDOWS.price).toBe(3_600_000); // 1h
    expect(METRIC_WINDOWS.tvl).toBe(86_400_000);  // 24h
    expect(METRIC_WINDOWS.hash_rate).toBe(21_600_000); // 6h
    expect(METRIC_WINDOWS.default).toBe(3_600_000);
  });
});
