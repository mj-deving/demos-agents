import {
  runMinimalAgentLoop,
  type MinimalObserveContext,
  type MinimalObserveResult,
} from "omniweb-toolkit/agent";

interface SkeletonState {
  lastTopic?: string;
  lastPublishedAt?: string;
}

interface Perception {
  shouldSkip: boolean;
  reason: string;
  facts: Record<string, unknown>;
  topic?: string;
  leaderboardSize?: number;
  feedCount?: number;
}

async function perceive(ctx: MinimalObserveContext<SkeletonState>): Promise<Perception> {
  const [feed, signals, leaderboard] = await Promise.all([
    ctx.omni.colony.getFeed({ limit: 10 }),
    ctx.omni.colony.getSignals(),
    ctx.omni.colony.getLeaderboard({ limit: 10 }),
  ]);

  if (!feed?.ok || !signals?.ok || !leaderboard?.ok) {
    return {
      shouldSkip: true,
      reason: "read_failed",
      facts: {
        feedOk: feed?.ok === true,
        signalsOk: signals?.ok === true,
        leaderboardOk: leaderboard?.ok === true,
      },
    };
  }

  const posts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const topSignal = Array.isArray(signals.data) ? signals.data[0] : null;
  const topic = topSignal && typeof topSignal === "object"
    ? ((topSignal as { shortTopic?: unknown; topic?: unknown }).shortTopic
      ?? (topSignal as { shortTopic?: unknown; topic?: unknown }).topic)
    : null;
  const normalizedTopic = typeof topic === "string" && topic.length > 0 ? topic : null;

  if (!normalizedTopic) {
    return {
      shouldSkip: true,
      reason: "no_signal_topic",
      facts: {
        feedCount: posts.length,
      },
    };
  }

  if (ctx.memory.state?.lastTopic === normalizedTopic) {
    return {
      shouldSkip: true,
      reason: "topic_unchanged",
      facts: {
        topic: normalizedTopic,
        lastPublishedAt: ctx.memory.state.lastPublishedAt ?? null,
      },
    };
  }

  return {
    shouldSkip: false,
    reason: "topic_ready",
    topic: normalizedTopic,
    leaderboardSize: Array.isArray(leaderboard.data) ? leaderboard.data.length : 0,
    feedCount: posts.length,
    facts: {
      topic: normalizedTopic,
      feedCount: posts.length,
      leaderboardSize: Array.isArray(leaderboard.data) ? leaderboard.data.length : 0,
    },
  };
}

function prompt(
  perception: Perception,
  ctx: MinimalObserveContext<SkeletonState>,
): MinimalObserveResult<SkeletonState> {
  if (perception.shouldSkip || !perception.topic) {
    return {
      kind: "skip",
      reason: perception.reason,
      facts: perception.facts,
      nextState: ctx.memory.state ?? {},
    };
  }

  return {
    kind: "publish",
    category: "ANALYSIS",
    text: [
      `${perception.topic} is emerging in colony signals.`,
      `Recent feed sample: ${perception.feedCount ?? 0} posts.`,
      `Leaderboard sample: ${perception.leaderboardSize ?? 0} agents.`,
      "Replace this placeholder text with one concrete claim and two reasons.",
    ].join(" "),
    attestUrl: "https://example.com/report",
    tags: ["starter", "analysis"],
    confidence: 60,
    facts: perception.facts,
    nextState: {
      lastTopic: perception.topic,
      lastPublishedAt: ctx.cycle.startedAt,
    },
  };
}

export async function observe(
  ctx: MinimalObserveContext<SkeletonState>,
): Promise<MinimalObserveResult<SkeletonState>> {
  const perception = await perceive(ctx);
  return prompt(perception, ctx);
}

await runMinimalAgentLoop(observe, {
  intervalMs: 5 * 60_000,
  dryRun: true,
});

// Review outputs after each cycle under ./.omniweb-agent/
// - state/current.json
// - runs/latest.json
// - runs/YYYY-MM-DD/<cycle-id>.json
// - runs/YYYY-MM-DD/<cycle-id>.md
//
// Remove dryRun only after your read path and attestation target are stable.
