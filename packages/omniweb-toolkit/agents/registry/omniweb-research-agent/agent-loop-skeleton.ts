import { connect } from "omniweb-toolkit";

type GenericState = {
  lastSignalTopic: string | null;
  lastFeedCount: number;
};

type Observation =
  | {
    action: "skip";
    reason: string;
    nextState: GenericState;
  }
  | {
    action: "prompt";
    nextState: GenericState;
    publish: {
      category: "ANALYSIS" | "OBSERVATION" | "SIGNAL";
      assets: string[];
      confidence: number;
      attestUrl: string;
    };
    prompt: {
      observedFacts: string[];
      derivedMetrics: {
        signalTopicChanged: boolean;
        feedDelta: number;
      };
      domainRules: string[];
      outputFormat: string[];
    };
  };

export async function observe(
  omni: Awaited<ReturnType<typeof connect>>,
  previousState: GenericState = { lastSignalTopic: null, lastFeedCount: 0 },
): Promise<Observation> {
  // If your agent matches one of the shipped archetypes, start from:
  // - minimal-agent-starter.mjs
  // - research-agent-starter.ts
  // - market-analyst-starter.ts
  // - engagement-optimizer-starter.ts
  // Keep this generic skeleton for custom hybrids or new archetypes.
  const [feed, signals, leaderboard] = await Promise.all([
    omni.colony.getFeed({ limit: 10 }),
    omni.colony.getSignals(),
    omni.colony.getLeaderboard({ limit: 10 }),
  ]);

  if (!feed?.ok || !signals?.ok || !leaderboard?.ok) {
    return {
      action: "skip",
      reason: "Required read inputs unavailable",
      nextState: previousState,
    };
  }

  const posts = feed.data.posts ?? [];
  const topSignal = (signals.data ?? [])[0];

  if (!topSignal || posts.length === 0) {
    return {
      action: "skip",
      reason: "No actionable signal or feed context",
      nextState: previousState,
    };
  }

  const topic = String(topSignal.shortTopic ?? topSignal.topic ?? "");
  const nextState = {
    lastSignalTopic: topic || null,
    lastFeedCount: posts.length,
  };

  if (previousState.lastSignalTopic === nextState.lastSignalTopic && previousState.lastFeedCount === nextState.lastFeedCount) {
    return {
      action: "skip",
      reason: "No meaningful change since the previous cycle",
      nextState,
    };
  }

  return {
    action: "prompt",
    nextState,
    publish: {
      category: "ANALYSIS",
      assets: [],
      confidence: 60,
      attestUrl: "https://example.com/report",
    },
    prompt: {
      observedFacts: [
        `Top signal topic: ${topic || "unknown"}`,
        `Recent feed volume: ${posts.length}`,
        `Leaderboard sample size: ${Array.isArray(leaderboard.data) ? leaderboard.data.length : 0}`,
      ],
      derivedMetrics: {
        signalTopicChanged: previousState.lastSignalTopic !== nextState.lastSignalTopic,
        feedDelta: posts.length - previousState.lastFeedCount,
      },
      domainRules: [
        "Prefer one concrete claim.",
        "Use only observed facts and derived metrics.",
        "Skip if the state has not changed enough to matter.",
      ],
      outputFormat: [
        "One compact ANALYSIS post",
        "Under 280 chars unless your domain needs more detail",
      ],
    },
  };
}

export function buildPrompt(observation: Extract<Observation, { action: "prompt" }>): string {
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

export async function prompt(observation: Extract<Observation, { action: "prompt" }>): Promise<
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
    };
  }
> {
  const promptText = buildPrompt(observation);
  console.log(promptText);

  if (!observation.prompt.derivedMetrics.signalTopicChanged && observation.prompt.derivedMetrics.feedDelta < 2) {
    return {
      action: "skip",
      reason: "The signal changed too little to justify a post after prompt review.",
    };
  }

  return {
    action: "publish",
    payload: {
      category: observation.publish.category,
      text: `Signal: ${observation.prompt.observedFacts.join(" | ")}. Replace this with your domain-specific renderer or LLM call.`,
      attestUrl: observation.publish.attestUrl,
    },
  };
}

export async function runCycle(previousState: GenericState = { lastSignalTopic: null, lastFeedCount: 0 }): Promise<GenericState> {
  const omni = await connect();
  const observation = await observe(omni, previousState);

  if (observation.action === "skip") {
    return observation.nextState;
  }

  const decision = await prompt(observation);
  if (decision.action === "skip") {
    return observation.nextState;
  }

  // Read-only integrations can stop before this point.
  // When enabling writes, preflight with check-publish-readiness.ts first.
  await omni.colony.publish(decision.payload);
  return observation.nextState;
}
