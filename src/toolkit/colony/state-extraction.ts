import { extractMentions } from "./scanner.js";
import type { ColonyDatabase } from "./schema.js";

export interface ColonyState {
  activity: {
    postsPerHour: number;
    activeAuthors: number;
    trendingTopics: Array<{ topic: string; count: number }>;
  };
  gaps: {
    underservedTopics: Array<{ topic: string; lastPostAt: string }>;
    unansweredQuestions: Array<{ txHash: string; text: string; timestamp: string }>;
    staleThreads: Array<{ rootTxHash: string; lastReplyAt: string }>;
  };
  threads: {
    activeDiscussions: Array<{ rootTxHash: string; replyCount: number; lastReplyAt: string }>;
    mentionsOfUs: Array<{ txHash: string; author: string; text: string }>;
  };
  agents: {
    topContributors: Array<{ author: string; postCount: number; avgReactions: number }>;
  };
}

export interface StateExtractionOptions {
  ourAddress?: string;
  activityWindowHours?: number;
  staleThreadHours?: number;
}

interface PostRow {
  tx_hash: string;
  author: string;
  timestamp: string;
  reply_to: string | null;
  tags: string;
  text: string;
}

interface ThreadRow {
  root_tx_hash: string;
  reply_count: number;
  last_reply_at: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_ACTIVITY_WINDOW_HOURS = 24;
const DEFAULT_STALE_THREAD_HOURS = 48;

function getReferenceNow(db: ColonyDatabase): Date {
  const latestTimestamp = db.prepare(`
    SELECT MAX(timestamp)
    FROM posts
  `).pluck().get() as string | null;

  return latestTimestamp ? new Date(latestTimestamp) : new Date();
}

function getRecentPosts(db: ColonyDatabase, since: string): PostRow[] {
  return db.prepare(`
    SELECT tx_hash, author, timestamp, reply_to, tags, text
    FROM posts
    WHERE timestamp >= ?
    ORDER BY timestamp DESC, tx_hash ASC
  `).all(since) as PostRow[];
}

function rankTopics(posts: PostRow[]): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();

  for (const post of posts) {
    const tags = JSON.parse(post.tags) as string[];
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count || left.topic.localeCompare(right.topic))
    .slice(0, 10);
}

function getUnderservedTopics(db: ColonyDatabase, now: Date): Array<{ topic: string; lastPostAt: string }> {
  const since = new Date(now.getTime() - (48 * HOUR_MS)).toISOString();
  const posts = getRecentPosts(db, since);
  const aggregates = new Map<string, { count: number; lastPostAt: string }>();

  for (const post of posts) {
    const tags = JSON.parse(post.tags) as string[];
    for (const tag of tags) {
      const current = aggregates.get(tag);
      if (!current) {
        aggregates.set(tag, { count: 1, lastPostAt: post.timestamp });
        continue;
      }

      current.count += 1;
      if (post.timestamp > current.lastPostAt) {
        current.lastPostAt = post.timestamp;
      }
    }
  }

  return [...aggregates.entries()]
    .filter(([, aggregate]) => aggregate.count <= 1)
    .map(([topic, aggregate]) => ({ topic, lastPostAt: aggregate.lastPostAt }))
    .sort((left, right) => left.lastPostAt.localeCompare(right.lastPostAt) || left.topic.localeCompare(right.topic));
}

function getUnansweredQuestions(db: ColonyDatabase): Array<{ tx_hash: string; text: string; timestamp: string }> {
  return db.prepare(`
    SELECT p.tx_hash, p.text, p.timestamp
    FROM posts p
    LEFT JOIN posts replies ON replies.reply_to = p.tx_hash
    WHERE p.text LIKE '%?%'
    GROUP BY p.tx_hash, p.text, p.timestamp
    HAVING COUNT(replies.tx_hash) = 0
    ORDER BY p.timestamp DESC, p.tx_hash ASC
  `).all() as Array<{ tx_hash: string; text: string; timestamp: string }>;
}

function getThreadStats(db: ColonyDatabase): ThreadRow[] {
  return db.prepare(`
    SELECT
      root.tx_hash AS root_tx_hash,
      COUNT(reply.tx_hash) AS reply_count,
      MAX(reply.timestamp) AS last_reply_at
    FROM posts root
    JOIN posts reply ON reply.reply_to = root.tx_hash
    WHERE root.reply_to IS NULL
    GROUP BY root.tx_hash
    ORDER BY last_reply_at DESC, root.tx_hash ASC
  `).all() as ThreadRow[];
}

function getMentionsOfUs(
  db: ColonyDatabase,
  ourAddress?: string,
): Array<{ txHash: string; author: string; text: string }> {
  if (!ourAddress) return [];

  const normalized = ourAddress.toLowerCase();
  const rows = db.prepare(`
    SELECT tx_hash, author, text
    FROM posts
    WHERE lower(text) LIKE ?
    ORDER BY timestamp DESC, tx_hash ASC
  `).all(`%${normalized}%`) as Array<{ tx_hash: string; author: string; text: string }>;

  return rows
    .filter((row) => {
      const mentions = extractMentions(row.text);
      return mentions.includes(normalized) || row.text.toLowerCase().includes(normalized);
    })
    .map((row) => ({
      txHash: row.tx_hash,
      author: row.author,
      text: row.text,
    }));
}

function getTopContributors(db: ColonyDatabase): Array<{ author: string; postCount: number; avgReactions: number }> {
  return db.prepare(`
    SELECT
      p.author AS author,
      COUNT(p.tx_hash) AS post_count,
      AVG(COALESCE(r.agrees, 0) + COALESCE(r.disagrees, 0) + COALESCE(r.reply_count, 0) + COALESCE(r.tips_count, 0)) AS avg_reactions
    FROM posts p
    LEFT JOIN reaction_cache r ON r.post_tx_hash = p.tx_hash
    GROUP BY p.author
    ORDER BY post_count DESC, avg_reactions DESC, p.author ASC
    LIMIT 10
  `).all() as Array<{ author: string; post_count: number; avg_reactions: number | null }>;
}

export function extractColonyState(
  db: ColonyDatabase,
  options: StateExtractionOptions = {},
): ColonyState {
  const activityWindowHours = options.activityWindowHours ?? DEFAULT_ACTIVITY_WINDOW_HOURS;
  const staleThreadHours = options.staleThreadHours ?? DEFAULT_STALE_THREAD_HOURS;
  const now = getReferenceNow(db);
  const recentSince = new Date(now.getTime() - (activityWindowHours * HOUR_MS)).toISOString();
  const activeDiscussionSince = new Date(now.getTime() - (24 * HOUR_MS)).toISOString();
  const staleThreadBefore = new Date(now.getTime() - (staleThreadHours * HOUR_MS)).toISOString();
  const recentPosts = getRecentPosts(db, recentSince);
  const threadStats = getThreadStats(db);

  return {
    activity: {
      postsPerHour: recentPosts.length / activityWindowHours,
      activeAuthors: new Set(recentPosts.map((post) => post.author)).size,
      trendingTopics: rankTopics(recentPosts),
    },
    gaps: {
      underservedTopics: getUnderservedTopics(db, now),
      unansweredQuestions: getUnansweredQuestions(db).map((row) => ({
        txHash: row.tx_hash,
        text: row.text,
        timestamp: row.timestamp,
      })),
      staleThreads: threadStats
        .filter((thread) => thread.last_reply_at < staleThreadBefore)
        .map((thread) => ({
          rootTxHash: thread.root_tx_hash,
          lastReplyAt: thread.last_reply_at,
        })),
    },
    threads: {
      activeDiscussions: threadStats
        .filter((thread) => thread.reply_count >= 2 && thread.last_reply_at >= activeDiscussionSince)
        .map((thread) => ({
          rootTxHash: thread.root_tx_hash,
          replyCount: Number(thread.reply_count),
          lastReplyAt: thread.last_reply_at,
        })),
      mentionsOfUs: getMentionsOfUs(db, options.ourAddress),
    },
    agents: {
      topContributors: getTopContributors(db).map((row) => ({
        author: row.author,
        postCount: Number(row.post_count),
        avgReactions: Number((row.avg_reactions ?? 0).toFixed(2)),
      })),
    },
  };
}
