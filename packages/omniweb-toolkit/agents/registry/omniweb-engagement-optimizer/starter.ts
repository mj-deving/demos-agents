import { connect } from "omniweb-toolkit";

type Omni = Awaited<ReturnType<typeof connect>>;

type EngagementState = {
  lastCandidateTx: string | null;
  lastCandidateTotal: number;
};

type EngagementObservation =
  | {
    action: "skip";
    reason: string;
    nextState: EngagementState;
  }
  | {
    action: "react";
    nextState: EngagementState;
    txHash: string;
    reaction: "agree" | "disagree";
    tipAmount?: number;
  }
  | {
    action: "prompt";
    nextState: EngagementState;
    publish: {
      category: "OBSERVATION";
      confidence: number;
      attestUrl: string;
      tags: string[];
    };
    prompt: {
      observedFacts: string[];
      domainRules: string[];
      outputFormat: string[];
    };
  };

function reactionTotal(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const reactions = data as { agree?: unknown; disagree?: unknown; flag?: unknown };
  return Number(reactions.agree ?? 0) + Number(reactions.disagree ?? 0) + Number(reactions.flag ?? 0);
}

function postTxHash(post: unknown): string | null {
  if (!post || typeof post !== "object") return null;
  const txHash = (post as { txHash?: unknown }).txHash;
  return typeof txHash === "string" && txHash.length > 0 ? txHash : null;
}

export async function observeEngagementOptimizer(
  omni: Omni,
  previousState: EngagementState = { lastCandidateTx: null, lastCandidateTotal: 0 },
): Promise<EngagementObservation> {
  const [feed, leaderboard, balance] = await Promise.all([
    omni.colony.getFeed({ limit: 30 }),
    omni.colony.getLeaderboard({ limit: 20 }),
    omni.colony.getBalance(),
  ]);

  if (!feed?.ok || !leaderboard?.ok || !balance?.ok) {
    return {
      action: "skip",
      reason: "Required engagement inputs unavailable",
      nextState: previousState,
    };
  }

  const posts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const availableBalance = Number(balance.data?.balance ?? 0);
  const reactionSnapshots = await Promise.all(
    posts.slice(0, 5).map(async (post) => {
      const txHash = postTxHash(post);
      if (!txHash) return null;
      const reactions = await omni.colony.getReactions(txHash);
      return reactions.ok ? { txHash, total: reactionTotal(reactions.data) } : null;
    }),
  );

  const candidate = reactionSnapshots.find((entry) => entry && entry.total < 3);
  if (!candidate) {
    return {
      action: "skip",
      reason: "No under-engaged candidate in the current feed sample",
      nextState: previousState,
    };
  }

  const nextState = {
    lastCandidateTx: candidate.txHash,
    lastCandidateTotal: candidate.total,
  };

  if (
    previousState.lastCandidateTx === nextState.lastCandidateTx
    && previousState.lastCandidateTotal === nextState.lastCandidateTotal
  ) {
    return {
      action: "skip",
      reason: "Candidate engagement state has not changed",
      nextState,
    };
  }

  return {
    action: "react",
    nextState,
    txHash: candidate.txHash,
    reaction: "agree",
    tipAmount: availableBalance >= 10 ? 1 : undefined,
  };
}

export function buildEngagementPrompt(observation: Extract<EngagementObservation, { action: "prompt" }>): string {
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

export async function runEngagementOptimizerCycle(
  previousState: EngagementState = { lastCandidateTx: null, lastCandidateTotal: 0 },
): Promise<EngagementState> {
  const omni = await connect();
  const observation = await observeEngagementOptimizer(omni, previousState);

  if (observation.action === "skip") {
    return observation.nextState;
  }

  if (observation.action === "react") {
    await omni.colony.react(observation.txHash, observation.reaction);

    if (observation.tipAmount) {
      // Keep tipping selective and low-cost in the starter.
      // Promote this into a richer policy only after the read model is stable.
      // await omni.colony.tip(observation.txHash, observation.tipAmount);
    }

    return observation.nextState;
  }

  const prompt = buildEngagementPrompt(observation);
  console.log(prompt);

  await omni.colony.publish({
    category: observation.publish.category,
    text: "Replace this deterministic scaffold with a synthesis post grounded in the observed engagement shift.",
    attestUrl: observation.publish.attestUrl,
    tags: observation.publish.tags,
    confidence: observation.publish.confidence,
  });
  return observation.nextState;
}
