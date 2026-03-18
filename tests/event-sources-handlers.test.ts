/**
 * Tests for all 4 event sources and all 4 event handlers.
 *
 * Sources: SocialReplySource, SocialMentionSource, TipReceivedSource, DisagreeMonitorSource
 * Handlers: ReplyHandler, MentionHandler, TipThanksHandler, DisagreeHandler
 */

import { describe, it, expect, vi } from "vitest";
import { makeAgentEvent } from "./fixtures/event-fixtures.js";

// ── Sources ──
import {
  createSocialReplySource,
  type ReplyPost,
} from "../tools/lib/event-sources/social-replies.js";
import {
  createSocialMentionSource,
  type MentionPost,
} from "../tools/lib/event-sources/social-mentions.js";
import {
  createTipReceivedSource,
  type TipRecord,
} from "../tools/lib/event-sources/tip-received.js";
import {
  createDisagreeMonitorSource,
  type DisagreePost,
} from "../tools/lib/event-sources/disagree-monitor.js";

// ── Handlers ──
import { createReplyHandler } from "../tools/lib/event-handlers/reply-handler.js";
import { createMentionHandler } from "../tools/lib/event-handlers/mention-handler.js";
import { createTipThanksHandler } from "../tools/lib/event-handlers/tip-thanks-handler.js";
import { createDisagreeHandler } from "../tools/lib/event-handlers/disagree-handler.js";

// ── Test Fixtures ──

function makeReply(overrides: Partial<ReplyPost> = {}): ReplyPost {
  return {
    txHash: "tx-reply-1",
    author: "0xABCDEF1234567890",
    timestamp: 1000,
    text: "This is a substantive reply with plenty of characters to exceed threshold",
    replyTo: "tx-own-1",
    ...overrides,
  };
}

function makeMention(overrides: Partial<MentionPost> = {}): MentionPost {
  return {
    txHash: "tx-mention-1",
    author: "0xMENTIONER",
    timestamp: 2000,
    text: "/ask @0xagentaddress What is the best staking strategy?",
    ...overrides,
  };
}

function makeTip(overrides: Partial<TipRecord> = {}): TipRecord {
  return {
    txHash: "tx-tip-1",
    from: "0xTIPPER",
    amount: 5,
    timestamp: 3000,
    ...overrides,
  };
}

function makeDisagreePost(overrides: Partial<DisagreePost> = {}): DisagreePost {
  return {
    txHash: "tx-disagree-1",
    timestamp: 4000,
    text: "Hot take: this protocol is overvalued",
    agreeCount: 2,
    disagreeCount: 5,
    disagreeRatio: 0.71,
    ...overrides,
  };
}

// ════════════════════════════════════════════
// EVENT SOURCES
// ════════════════════════════════════════════

describe("SocialReplySource", () => {
  const ownHashes = new Set(["tx-own-1", "tx-own-2"]);

  function makeSource(posts: ReplyPost[]) {
    return createSocialReplySource({
      fetchFeed: vi.fn().mockResolvedValue(posts),
      ownTxHashes: () => ownHashes,
    });
  }

  it("has correct id and eventTypes", () => {
    const source = makeSource([]);
    expect(source.id).toBe("social:replies");
    expect(source.eventTypes).toEqual(["reply"]);
  });

  it("poll filters posts by ownTxHashes", async () => {
    const source = makeSource([
      makeReply({ txHash: "r1", replyTo: "tx-own-1" }),
      makeReply({ txHash: "r2", replyTo: "tx-other" }),
      makeReply({ txHash: "r3", replyTo: "tx-own-2" }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.posts).toHaveLength(2);
    expect(snapshot.posts.map(p => p.txHash)).toEqual(["r1", "r3"]);
  });

  it("poll returns empty when no replies match", async () => {
    const source = makeSource([
      makeReply({ txHash: "r1", replyTo: "tx-unrelated" }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.posts).toHaveLength(0);
  });

  it("diff detects new replies (prev is null)", () => {
    const source = makeSource([]);
    const curr = {
      timestamp: 1000,
      posts: [makeReply({ txHash: "r1" }), makeReply({ txHash: "r2" })],
    };
    const events = source.diff(null, curr);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("reply");
    expect(events[0].sourceId).toBe("social:replies");
    expect(events[0].payload).toEqual(curr.posts[0]);
    expect(events[1].payload).toEqual(curr.posts[1]);
  });

  it("diff ignores already-seen replies", () => {
    const source = makeSource([]);
    const prev = {
      timestamp: 1000,
      posts: [makeReply({ txHash: "r1" })],
    };
    const curr = {
      timestamp: 2000,
      posts: [makeReply({ txHash: "r1" }), makeReply({ txHash: "r2" })],
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.txHash).toBe("r2");
  });

  it("extractWatermark returns null for empty snapshot", () => {
    const source = makeSource([]);
    expect(source.extractWatermark({ timestamp: 0, posts: [] })).toBeNull();
  });

  it("extractWatermark returns latest post watermark", () => {
    const source = makeSource([]);
    const snapshot = {
      timestamp: 5000,
      posts: [
        makeReply({ txHash: "r1", timestamp: 100 }),
        makeReply({ txHash: "r2", timestamp: 300 }),
        makeReply({ txHash: "r3", timestamp: 200 }),
      ],
    };
    const wm = source.extractWatermark(snapshot) as { txHash: string; timestamp: number };
    expect(wm.txHash).toBe("r2");
    expect(wm.timestamp).toBe(300);
  });
});

describe("SocialMentionSource", () => {
  const agentAddress = "0xAgentAddress";

  function makeSource(posts: MentionPost[]) {
    return createSocialMentionSource({
      fetchFeed: vi.fn().mockResolvedValue(posts),
      agentAddress,
    });
  }

  it("has correct id and eventTypes", () => {
    const source = makeSource([]);
    expect(source.id).toBe("social:mentions");
    expect(source.eventTypes).toEqual(["ask_mention"]);
  });

  it("poll filters by /ask + address (case-insensitive)", async () => {
    const source = makeSource([
      makeMention({ txHash: "m1", text: "/ask @0xagentaddress What about ETH?" }),
      makeMention({ txHash: "m2", text: "Random post no mention" }),
      makeMention({ txHash: "m3", text: "/ASK @0xAGENTADDRESS uppercase also works" }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.mentions).toHaveLength(2);
    expect(snapshot.mentions.map(m => m.txHash)).toEqual(["m1", "m3"]);
  });

  it("poll skips posts without /ask", async () => {
    const source = makeSource([
      makeMention({ txHash: "m1", text: "Hey 0xagentaddress check this out" }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.mentions).toHaveLength(0);
  });

  it("poll skips posts without agent address", async () => {
    const source = makeSource([
      makeMention({ txHash: "m1", text: "/ask @0xsomeoneelse What about DEM?" }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.mentions).toHaveLength(0);
  });

  it("diff detects new mentions", () => {
    const source = makeSource([]);
    const curr = {
      timestamp: 2000,
      mentions: [makeMention({ txHash: "m1" })],
    };
    const events = source.diff(null, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("ask_mention");
    expect(events[0].sourceId).toBe("social:mentions");
  });

  it("diff ignores already-seen mentions", () => {
    const source = makeSource([]);
    const prev = { timestamp: 1000, mentions: [makeMention({ txHash: "m1" })] };
    const curr = {
      timestamp: 2000,
      mentions: [makeMention({ txHash: "m1" }), makeMention({ txHash: "m2" })],
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.txHash).toBe("m2");
  });

  it("extractWatermark returns null for empty snapshot", () => {
    const source = makeSource([]);
    expect(source.extractWatermark({ timestamp: 0, mentions: [] })).toBeNull();
  });

  it("extractWatermark returns latest mention", () => {
    const source = makeSource([]);
    const snapshot = {
      timestamp: 5000,
      mentions: [
        makeMention({ txHash: "m1", timestamp: 100 }),
        makeMention({ txHash: "m2", timestamp: 500 }),
      ],
    };
    const wm = source.extractWatermark(snapshot) as { txHash: string; timestamp: number };
    expect(wm.txHash).toBe("m2");
    expect(wm.timestamp).toBe(500);
  });
});

describe("TipReceivedSource", () => {
  function makeSource(tips: TipRecord[]) {
    return createTipReceivedSource({
      fetchTips: vi.fn().mockResolvedValue(tips),
    });
  }

  it("has correct id and eventTypes", () => {
    const source = makeSource([]);
    expect(source.id).toBe("social:tips");
    expect(source.eventTypes).toEqual(["tip_received"]);
  });

  it("poll returns all tips", async () => {
    const tips = [makeTip({ txHash: "t1" }), makeTip({ txHash: "t2" })];
    const source = makeSource(tips);
    const snapshot = await source.poll();
    expect(snapshot.tips).toHaveLength(2);
    expect(snapshot.tips).toEqual(tips);
  });

  it("diff detects new tips by txHash", () => {
    const source = makeSource([]);
    const prev = { timestamp: 1000, tips: [makeTip({ txHash: "t1" })] };
    const curr = {
      timestamp: 2000,
      tips: [makeTip({ txHash: "t1" }), makeTip({ txHash: "t2" })],
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tip_received");
    expect(events[0].payload.txHash).toBe("t2");
  });

  it("diff returns all tips when prev is null", () => {
    const source = makeSource([]);
    const curr = {
      timestamp: 1000,
      tips: [makeTip({ txHash: "t1" }), makeTip({ txHash: "t2" })],
    };
    const events = source.diff(null, curr);
    expect(events).toHaveLength(2);
  });

  it("diff returns empty when no new tips", () => {
    const source = makeSource([]);
    const prev = { timestamp: 1000, tips: [makeTip({ txHash: "t1" })] };
    const curr = { timestamp: 2000, tips: [makeTip({ txHash: "t1" })] };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(0);
  });

  it("extractWatermark returns null for empty snapshot", () => {
    const source = makeSource([]);
    expect(source.extractWatermark({ timestamp: 0, tips: [] })).toBeNull();
  });

  it("extractWatermark returns latest tip", () => {
    const source = makeSource([]);
    const snapshot = {
      timestamp: 5000,
      tips: [
        makeTip({ txHash: "t1", timestamp: 100 }),
        makeTip({ txHash: "t2", timestamp: 400 }),
        makeTip({ txHash: "t3", timestamp: 200 }),
      ],
    };
    const wm = source.extractWatermark(snapshot) as { txHash: string; timestamp: number };
    expect(wm.txHash).toBe("t2");
    expect(wm.timestamp).toBe(400);
  });
});

describe("DisagreeMonitorSource", () => {
  function makeSource(posts: DisagreePost[], threshold?: number) {
    return createDisagreeMonitorSource({
      fetchOwnPosts: vi.fn().mockResolvedValue(posts),
      disagreeThreshold: threshold,
    });
  }

  it("has correct id and eventTypes", () => {
    const source = makeSource([]);
    expect(source.id).toBe("social:disagrees");
    expect(source.eventTypes).toEqual(["high_disagree"]);
  });

  it("poll filters by threshold (default 30%)", async () => {
    const source = makeSource([
      makeDisagreePost({ txHash: "d1", agreeCount: 8, disagreeCount: 2, disagreeRatio: 0.2 }),
      makeDisagreePost({ txHash: "d2", agreeCount: 2, disagreeCount: 5, disagreeRatio: 0.71 }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0].txHash).toBe("d2");
  });

  it("poll filters by custom threshold", async () => {
    const source = makeSource(
      [
        makeDisagreePost({ txHash: "d1", agreeCount: 4, disagreeCount: 3, disagreeRatio: 0.43 }),
        makeDisagreePost({ txHash: "d2", agreeCount: 1, disagreeCount: 6, disagreeRatio: 0.86 }),
      ],
      0.5,
    );
    const snapshot = await source.poll();
    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0].txHash).toBe("d2");
  });

  it("poll requires minimum 3 total reactions", async () => {
    const source = makeSource([
      makeDisagreePost({ txHash: "d1", agreeCount: 0, disagreeCount: 2, disagreeRatio: 1.0 }),
    ]);
    const snapshot = await source.poll();
    expect(snapshot.posts).toHaveLength(0);
  });

  it("diff only alerts once per post (internal alerted set)", () => {
    const source = makeSource([]);
    const snapshot = {
      timestamp: 1000,
      posts: [makeDisagreePost({ txHash: "d1" })],
    };

    // First diff should emit
    const events1 = source.diff(null, snapshot);
    expect(events1).toHaveLength(1);
    expect(events1[0].type).toBe("high_disagree");

    // Second diff with same post should NOT emit
    const events2 = source.diff(null, snapshot);
    expect(events2).toHaveLength(0);
  });

  it("diff emits for new posts but not for previously alerted", () => {
    const source = makeSource([]);
    const snapshot1 = {
      timestamp: 1000,
      posts: [makeDisagreePost({ txHash: "d1" })],
    };
    source.diff(null, snapshot1);

    const snapshot2 = {
      timestamp: 2000,
      posts: [
        makeDisagreePost({ txHash: "d1" }),
        makeDisagreePost({ txHash: "d2" }),
      ],
    };
    const events = source.diff(snapshot1, snapshot2);
    expect(events).toHaveLength(1);
    expect(events[0].payload.txHash).toBe("d2");
  });

  it("extractWatermark returns null for empty snapshot", () => {
    const source = makeSource([]);
    expect(source.extractWatermark({ timestamp: 0, posts: [] })).toBeNull();
  });

  it("extractWatermark returns latest post", () => {
    const source = makeSource([]);
    const snapshot = {
      timestamp: 5000,
      posts: [
        makeDisagreePost({ txHash: "d1", timestamp: 100 }),
        makeDisagreePost({ txHash: "d2", timestamp: 600 }),
      ],
    };
    const wm = source.extractWatermark(snapshot) as { txHash: string; timestamp: number };
    expect(wm.txHash).toBe("d2");
    expect(wm.timestamp).toBe(600);
  });
});

// ════════════════════════════════════════════
// EVENT HANDLERS
// ════════════════════════════════════════════

describe("ReplyHandler", () => {
  const handler = createReplyHandler();

  it("has correct name and eventTypes", () => {
    expect(handler.name).toBe("reply-handler");
    expect(handler.eventTypes).toEqual(["reply"]);
  });

  it("returns log_only for short replies (< 30 chars)", async () => {
    const event = makeAgentEvent({
      id: "social:replies:1000:tx1",
      sourceId: "social:replies",
      type: "reply",
      payload: makeReply({ text: "Nice post!", txHash: "tx-short" }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.reason).toBe("reply too short");
    expect(action!.params.txHash).toBe("tx-short");
  });

  it("returns react/agree for substantive replies (>= 30 chars)", async () => {
    const event = makeAgentEvent({
      id: "social:replies:1000:tx2",
      sourceId: "social:replies",
      type: "reply",
      payload: makeReply({
        text: "This is a really thoughtful and detailed reply about the topic at hand",
        txHash: "tx-substantive",
        author: "0xAUTHOR1234",
      }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("react");
    expect(action!.params.txHash).toBe("tx-substantive");
    expect(action!.params.reaction).toBe("agree");
    expect(action!.params.reason).toContain("0xAUTHOR12");
  });

  it("boundary: exactly 29 chars is log_only", async () => {
    const event = makeAgentEvent({
      sourceId: "social:replies",
      type: "reply",
      payload: makeReply({ text: "a".repeat(29) }),
    });
    const action = await handler.handle(event);
    expect(action!.type).toBe("log_only");
  });

  it("boundary: exactly 30 chars is react", async () => {
    const event = makeAgentEvent({
      sourceId: "social:replies",
      type: "reply",
      payload: makeReply({ text: "a".repeat(30) }),
    });
    const action = await handler.handle(event);
    expect(action!.type).toBe("react");
  });
});

describe("MentionHandler", () => {
  const handler = createMentionHandler();

  it("has correct name and eventTypes", () => {
    expect(handler.name).toBe("mention-handler");
    expect(handler.eventTypes).toEqual(["ask_mention"]);
  });

  it("extracts question from /ask @address pattern", async () => {
    const event = makeAgentEvent({
      sourceId: "social:mentions",
      type: "ask_mention",
      payload: makeMention({
        text: "/ask @0xAgent What is the best staking strategy?",
        txHash: "tx-q1",
        author: "0xAsker",
      }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("reply");
    expect(action!.params.question).toBe("What is the best staking strategy?");
    expect(action!.params.parentTx).toBe("tx-q1");
    expect(action!.params.author).toBe("0xAsker");
  });

  it("returns log_only for too-short questions (< 5 chars)", async () => {
    const event = makeAgentEvent({
      sourceId: "social:mentions",
      type: "ask_mention",
      payload: makeMention({ text: "/ask @0xAgent Hi", txHash: "tx-short" }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.reason).toBe("mention too short to answer");
  });

  it("falls back to full text if /ask pattern has no question", async () => {
    // When regex doesn't match, question = mention.text (the full thing)
    const event = makeAgentEvent({
      sourceId: "social:mentions",
      type: "ask_mention",
      payload: makeMention({ text: "This is a long enough text without the ask pattern format" }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    // Full text is > 5 chars so it should be a reply action
    expect(action!.type).toBe("reply");
    expect(action!.params.question).toBe("This is a long enough text without the ask pattern format");
  });

  it("returns reply with original text preserved", async () => {
    const originalText = "/ask @0xAgent Can you explain the consensus mechanism in detail?";
    const event = makeAgentEvent({
      sourceId: "social:mentions",
      type: "ask_mention",
      payload: makeMention({ text: originalText }),
    });
    const action = await handler.handle(event);
    expect(action!.params.originalText).toBe(originalText);
  });
});

describe("TipThanksHandler", () => {
  const handler = createTipThanksHandler();

  it("has correct name and eventTypes", () => {
    expect(handler.name).toBe("tip-thanks-handler");
    expect(handler.eventTypes).toEqual(["tip_received"]);
  });

  it("always returns log_only with tip details", async () => {
    const tip = makeTip({ txHash: "tx-tip-42", from: "0xGenerous", amount: 7 });
    const event = makeAgentEvent({
      sourceId: "social:tips",
      type: "tip_received",
      payload: tip,
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.reason).toBe("tip received");
    expect(action!.params.from).toBe("0xGenerous");
    expect(action!.params.amount).toBe(7);
    expect(action!.params.txHash).toBe("tx-tip-42");
    expect(action!.params.acknowledgment).toBe(true);
  });

  it("handles small tips the same way", async () => {
    const event = makeAgentEvent({
      sourceId: "social:tips",
      type: "tip_received",
      payload: makeTip({ amount: 1 }),
    });
    const action = await handler.handle(event);
    expect(action!.type).toBe("log_only");
    expect(action!.params.amount).toBe(1);
  });

  it("handles large tips the same way", async () => {
    const event = makeAgentEvent({
      sourceId: "social:tips",
      type: "tip_received",
      payload: makeTip({ amount: 10 }),
    });
    const action = await handler.handle(event);
    expect(action!.type).toBe("log_only");
    expect(action!.params.amount).toBe(10);
  });
});

describe("DisagreeHandler", () => {
  const handler = createDisagreeHandler();

  it("has correct name and eventTypes", () => {
    expect(handler.name).toBe("disagree-handler");
    expect(handler.eventTypes).toEqual(["high_disagree"]);
  });

  it("returns log_only with disagree ratio and counts", async () => {
    const post = makeDisagreePost({
      txHash: "tx-bad-take",
      disagreeRatio: 0.65,
      agreeCount: 3,
      disagreeCount: 6,
      text: "Hot take that got pushback from the community",
    });
    const event = makeAgentEvent({
      sourceId: "social:disagrees",
      type: "high_disagree",
      payload: post,
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.reason).toBe("high disagree ratio detected");
    expect(action!.params.txHash).toBe("tx-bad-take");
    expect(action!.params.disagreeRatio).toBe(0.65);
    expect(action!.params.agreeCount).toBe(3);
    expect(action!.params.disagreeCount).toBe(6);
    expect(action!.params.actionRequired).toBe("review in next scheduled session");
  });

  it("truncates textPreview to 100 chars", async () => {
    const longText = "A".repeat(200);
    const event = makeAgentEvent({
      sourceId: "social:disagrees",
      type: "high_disagree",
      payload: makeDisagreePost({ text: longText }),
    });
    const action = await handler.handle(event);
    expect(action!.params.textPreview).toBe("A".repeat(100));
  });

  it("preserves short text fully in textPreview", async () => {
    const shortText = "Brief controversial take";
    const event = makeAgentEvent({
      sourceId: "social:disagrees",
      type: "high_disagree",
      payload: makeDisagreePost({ text: shortText }),
    });
    const action = await handler.handle(event);
    expect(action!.params.textPreview).toBe(shortText);
  });
});
