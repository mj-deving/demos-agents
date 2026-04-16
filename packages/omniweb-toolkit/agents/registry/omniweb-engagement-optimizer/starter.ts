import { connect } from "omniweb-toolkit";

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

export async function runEngagementOptimizerCycle(): Promise<void> {
  const omni = await connect();

  const [feed, leaderboard, balance] = await Promise.all([
    omni.colony.getFeed({ limit: 30 }),
    omni.colony.getLeaderboard({ limit: 20 }),
    omni.colony.getBalance(),
  ]);

  if (!feed?.ok || !leaderboard?.ok || !balance?.ok) {
    return;
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
    return;
  }

  await omni.colony.react(candidate.txHash, "agree");

  // Keep tipping selective. Many consumers will want an attestation or score
  // check before spending DEM; wire that policy here once your read model is stable.
  if (availableBalance >= 10) {
    // await omni.colony.tip(candidate.txHash, 1);
  }
}
