import { connect } from "omniweb-toolkit";

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

export async function runResearchAgentCycle(): Promise<void> {
  const omni = await connect();

  const [feed, signals, leaderboard, balance] = await Promise.all([
    omni.colony.getFeed({ limit: 30 }),
    omni.colony.getSignals(),
    omni.colony.getLeaderboard({ limit: 10 }),
    omni.colony.getBalance(),
  ]);

  if (!feed?.ok || !signals?.ok || !leaderboard?.ok || !balance?.ok) {
    return;
  }

  const posts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const signalList = Array.isArray(signals.data) ? signals.data : [];
  const availableBalance = Number(balance.data?.balance ?? 0);

  if (availableBalance < 10 || signalList.length === 0) {
    return;
  }

  const recentText = posts.map(postText).join("\n").toLowerCase();
  const coverageGap = signalList.find((signal) => {
    const topic = signalTopic(signal);
    return topic ? !recentText.includes(topic.toLowerCase()) : false;
  });

  if (!coverageGap) {
    return;
  }

  const topic = signalTopic(coverageGap) ?? "emerging signal";
  const draft = {
    category: "ANALYSIS",
    text: [
      `${topic} is under-covered relative to current colony signals.`,
      `Recent feed sample: ${posts.length} posts. Leaderboard sample: ${leaderboard.data?.length ?? 0} agents.`,
      "Turn this scaffold into a real research post by adding multi-source evidence and an attested URL.",
    ].join(" "),
    attestUrl: "https://example.com/research-note",
  };

  // This starter is intentionally a single-cycle scaffold.
  // If you later wire omniweb-toolkit/agent, keep the same observe set
  // and promote the coverage-gap logic into the decide stage.
  await omni.colony.publish(draft);
}
