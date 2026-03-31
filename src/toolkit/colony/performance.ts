import type { ColonyDatabase } from "./schema.js";
import { computeMedian } from "../math/baseline.js";
import type { PostPerformance, StrategyConfig } from "../strategy/types.js";

interface PerformanceRow {
  tx_hash: string;
  timestamp: string;
  agrees: number;
  disagrees: number;
  tips_count: number;
  tips_total_dem: number;
}

interface ReactionTotalRow {
  total_reactions: number;
}

interface ThreadStatsRow {
  total_replies: number;
  max_depth: number;
}

function getOurPosts(db: ColonyDatabase, ourAddress: string): PerformanceRow[] {
  return db.prepare(`
    SELECT
      p.tx_hash,
      p.timestamp,
      COALESCE(r.agrees, 0) AS agrees,
      COALESCE(r.disagrees, 0) AS disagrees,
      COALESCE(r.tips_count, 0) AS tips_count,
      COALESCE(r.tips_total_dem, 0) AS tips_total_dem
    FROM posts p
    LEFT JOIN reaction_cache r ON r.post_tx_hash = p.tx_hash
    WHERE p.author = ?
    ORDER BY p.timestamp DESC, p.tx_hash ASC
  `).all(ourAddress) as PerformanceRow[];
}

function getColonyReactionTotals(db: ColonyDatabase): number[] {
  const rows = db.prepare(`
    SELECT (agrees + disagrees + tips_count + reply_count) AS total_reactions
    FROM reaction_cache
    ORDER BY post_tx_hash ASC
  `).all() as ReactionTotalRow[];

  return rows.map((row) => Number(row.total_reactions));
}

function getThreadStats(db: ColonyDatabase, txHash: string): ThreadStatsRow {
  const row = db.prepare(`
    WITH RECURSIVE thread AS (
      SELECT tx_hash, 1 AS depth
      FROM posts
      WHERE reply_to = ?
      UNION ALL
      SELECT p.tx_hash, thread.depth + 1 AS depth
      FROM posts p
      JOIN thread ON p.reply_to = thread.tx_hash
    )
    SELECT
      COUNT(*) AS total_replies,
      COALESCE(MAX(depth), 0) AS max_depth
    FROM thread
  `).get(txHash) as ThreadStatsRow | undefined;

  return {
    total_replies: Number(row?.total_replies ?? 0),
    max_depth: Number(row?.max_depth ?? 0),
  };
}

export function computePerformanceScores(
  db: ColonyDatabase,
  ourAddress: string,
  config: StrategyConfig["performance"],
  now = new Date(),
): PostPerformance[] {
  const posts = getOurPosts(db, ourAddress);
  if (posts.length === 0) {
    return [];
  }

  const colonyMedianReactions = computeMedian(getColonyReactionTotals(db));

  return posts
    .map((post) => {
      const totalReactions = post.agrees + post.disagrees + post.tips_count;
      const threadStats = getThreadStats(db, post.tx_hash);

      const engagement = totalReactions === 0
        ? 0
        : colonyMedianReactions > 0
          ? (totalReactions / colonyMedianReactions) * config.engagement
          : config.engagement;
      const discussion = threadStats.total_replies * config.discussion;
      const replyBonuses = (threadStats.total_replies > 0 ? config.replyBase : 0)
        + (threadStats.total_replies > 3 ? config.replyDeep : 0)
        + (threadStats.max_depth > 2 ? config.threadDepth : 0);
      const economic = post.tips_count > 0 || post.tips_total_dem > 0
        ? config.economic + config.tipBase + Math.min(post.tips_total_dem * config.tipMultiplier, config.tipCap)
        : 0;
      const controversy = post.agrees > 0 && post.disagrees > 0 && threadStats.max_depth > 1
        ? config.controversy
        : 0;
      const rawScore = engagement + discussion + replyBonuses + economic + controversy;
      const ageHours = Math.max(0, (now.getTime() - Date.parse(post.timestamp)) / (1000 * 60 * 60));
      const decayedScore = rawScore * (2 ** (-ageHours / config.ageHalfLife));

      return {
        txHash: post.tx_hash,
        timestamp: post.timestamp,
        rawScore,
        decayedScore,
        breakdown: {
          engagement,
          discussion,
          economic,
          controversy,
        },
      };
    })
    .sort((left, right) =>
      right.decayedScore - left.decayedScore
      || right.timestamp.localeCompare(left.timestamp)
      || left.txHash.localeCompare(right.txHash)
    );
}
