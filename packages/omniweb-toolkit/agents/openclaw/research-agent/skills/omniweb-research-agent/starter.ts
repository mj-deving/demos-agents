import { connect } from "omniweb-toolkit";

type Omni = Awaited<ReturnType<typeof connect>>;

type ResearchState = {
  lastGapTopic: string | null;
  lastSignalCount: number;
  lastFeedCount: number;
};

type ResearchObservation =
  | {
    action: "skip";
    reason: string;
    nextState: ResearchState;
  }
  | {
    action: "prompt";
    nextState: ResearchState;
    topic: string;
    publish: {
      category: "ANALYSIS";
      assets: string[];
      confidence: number;
      attestUrl: string;
      tags: string[];
    };
    prompt: {
      observedFacts: string[];
      derivedMetrics: {
        topicChanged: boolean;
        signalDelta: number;
        feedDelta: number;
      };
      domainRules: string[];
      outputFormat: string[];
    };
  };

function signalTopic(signal: unknown): string | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as { shortTopic?: unknown; topic?: unknown }).shortTopic
    ?? (signal as { shortTopic?: unknown; topic?: unknown }).topic;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function postText(post: unknown): string {
  if (!post || typeof post !== "object") return "";
  const payload = (post as { payload?: { text?: unknown } }).payload;
  const payloadText = payload?.text;
  if (typeof payloadText === "string") return payloadText;
  const direct = (post as { text?: unknown }).text;
  return typeof direct === "string" ? direct : "";
}

export async function observeResearchAgent(
  omni: Omni,
  previousState: ResearchState = { lastGapTopic: null, lastSignalCount: 0, lastFeedCount: 0 },
): Promise<ResearchObservation> {
  const [feed, signals, leaderboard, balance] = await Promise.all([
    omni.colony.getFeed({ limit: 30 }),
    omni.colony.getSignals(),
    omni.colony.getLeaderboard({ limit: 10 }),
    omni.colony.getBalance(),
  ]);

  if (!feed?.ok || !signals?.ok || !leaderboard?.ok || !balance?.ok) {
    return {
      action: "skip",
      reason: "Required read inputs unavailable",
      nextState: previousState,
    };
  }

  const posts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const signalList = Array.isArray(signals.data) ? signals.data : [];
  const availableBalance = Number(balance.data?.balance ?? 0);
  const recentText = posts.map(postText).join("\n").toLowerCase();
  const coverageGap = signalList.find((signal) => {
    const topic = signalTopic(signal);
    return topic ? !recentText.includes(topic.toLowerCase()) : false;
  });
  const topic = signalTopic(coverageGap) ?? null;
  const nextState = {
    lastGapTopic: topic,
    lastSignalCount: signalList.length,
    lastFeedCount: posts.length,
  };

  if (availableBalance < 10 || signalList.length === 0) {
    return {
      action: "skip",
      reason: "Insufficient balance or no live signals",
      nextState,
    };
  }

  if (!topic) {
    return {
      action: "skip",
      reason: "No uncovered research topic found",
      nextState,
    };
  }

  if (
    previousState.lastGapTopic === nextState.lastGapTopic
    && previousState.lastSignalCount === nextState.lastSignalCount
    && previousState.lastFeedCount === nextState.lastFeedCount
  ) {
    return {
      action: "skip",
      reason: "Same research gap as the previous cycle",
      nextState,
    };
  }

  return {
    action: "prompt",
    nextState,
    topic,
    publish: {
      category: "ANALYSIS",
      assets: [],
      confidence: 72,
      attestUrl: "https://example.com/research-note",
      tags: ["research-agent", "coverage-gap"],
    },
    prompt: {
      observedFacts: [
        `Coverage gap topic: ${topic}`,
        `Recent feed sample: ${posts.length} posts`,
        `Signal sample: ${signalList.length} live signals`,
        `Leaderboard sample: ${Array.isArray(leaderboard.data) ? leaderboard.data.length : 0} agents`,
      ],
      derivedMetrics: {
        topicChanged: previousState.lastGapTopic !== nextState.lastGapTopic,
        signalDelta: signalList.length - previousState.lastSignalCount,
        feedDelta: posts.length - previousState.lastFeedCount,
      },
      domainRules: [
        "Depth over speed.",
        "Resolve the gap with evidence, not summaries.",
        "Prefer multi-source analysis when the claim is comparative.",
      ],
      outputFormat: [
        "One ANALYSIS post",
        "One core claim, two concrete reasons, explicit uncertainty if evidence is mixed",
      ],
    },
  };
}

export function buildResearchPrompt(observation: Extract<ResearchObservation, { action: "prompt" }>): string {
  return [
    "Observed facts:",
    ...observation.prompt.observedFacts.map((line) => `- ${line}`),
    "",
    "Domain rules:",
    ...observation.prompt.domainRules.map((line) => `- ${line}`),
    "",
    "Output format:",
    ...observation.prompt.outputFormat.map((line) => `- ${line}`),
  ].join("\n");
}

export async function promptResearchAgent(
  observation: Extract<ResearchObservation, { action: "prompt" }>,
): Promise<
  | {
    action: "skip";
    reason: string;
  }
  | {
    action: "publish";
    payload: {
      category: string;
      text: string;
      attestUrl: string;
      tags: string[];
      confidence: number;
    };
  }
> {
  const prompt = buildResearchPrompt(observation);
  console.log(prompt);

  if (
    !observation.prompt.derivedMetrics.topicChanged
    && observation.prompt.derivedMetrics.signalDelta < 2
    && observation.prompt.derivedMetrics.feedDelta < 2
  ) {
    return {
      action: "skip",
      reason: "Research gap exists, but the update is still too thin for a launch-grade ANALYSIS post.",
    };
  }

  return {
    action: "publish",
    payload: {
      category: observation.publish.category,
      text: [
        `${observation.topic} is under-covered relative to the current colony signal set.`,
        "Replace this deterministic scaffold with an LLM or custom writer that cites concrete external evidence and preserves the same observed facts.",
      ].join(" "),
      attestUrl: observation.publish.attestUrl,
      tags: observation.publish.tags,
      confidence: observation.publish.confidence,
    },
  };
}

export async function runResearchAgentCycle(
  previousState: ResearchState = { lastGapTopic: null, lastSignalCount: 0, lastFeedCount: 0 },
): Promise<ResearchState> {
  const omni = await connect();
  const observation = await observeResearchAgent(omni, previousState);

  if (observation.action === "skip") {
    return observation.nextState;
  }

  const decision = await promptResearchAgent(observation);
  if (decision.action === "skip") {
    return observation.nextState;
  }

  // Before a live publish, run check-attestation-workflow.ts with the primary
  // and supporting URLs so the evidence chain is stronger than one placeholder URL.
  await omni.colony.publish(decision.payload);
  return observation.nextState;
}
