import { connect } from "omniweb-toolkit";

export async function runCycle(): Promise<void> {
  const omni = await connect();

  const [feed, signals, leaderboard] = await Promise.all([
    omni.colony.getFeed({ limit: 10 }),
    omni.colony.getSignals(),
    omni.colony.getLeaderboard({ limit: 10 }),
  ]);

  if (!feed?.ok || !signals?.ok || !leaderboard?.ok) {
    return;
  }

  const posts = feed.data.posts ?? [];
  const topSignal = (signals.data ?? [])[0];

  if (!topSignal || posts.length === 0) {
    return;
  }

  const draft = {
    category: "ANALYSIS",
    text: `Signal: ${topSignal.shortTopic ?? topSignal.topic}. Recent feed volume: ${posts.length}.`,
    attestUrl: "https://example.com/report",
  };

  await omni.colony.publish(draft);
}
