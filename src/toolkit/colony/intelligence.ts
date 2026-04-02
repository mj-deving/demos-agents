import type { ColonyDatabase } from "./schema.js";

export interface AgentProfileRecord {
  address: string;
  firstSeenAt: string;
  lastSeenAt: string;
  postCount: number;
  avgAgrees: number;
  avgDisagrees: number;
  topics: string[];
  trustScore: number | null;
}

export interface InteractionRecord {
  id?: number;
  ourTxHash: string;
  theirTxHash: string | null;
  theirAddress: string;
  interactionType:
    | "reply_to_us"
    | "we_replied"
    | "agreed"
    | "disagreed"
    | "tipped_us"
    | "we_tipped";
  timestamp: string;
}

export interface InteractionFilter {
  address?: string;
  type?: InteractionRecord["interactionType"];
  since?: string;
  limit?: number;
}

interface AgentProfileRow {
  address: string;
  first_seen_at: string;
  last_seen_at: string;
  post_count: number;
  avg_agrees: number;
  avg_disagrees: number;
  topics_json: string;
  trust_score: number | null;
}

interface InteractionRow {
  id: number;
  our_tx_hash: string;
  their_tx_hash: string | null;
  their_address: string;
  interaction_type: InteractionRecord["interactionType"];
  timestamp: string;
}

function mapProfileRow(row: AgentProfileRow | undefined): AgentProfileRecord | null {
  if (!row) {
    return null;
  }
  return {
    address: row.address,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    postCount: row.post_count,
    avgAgrees: row.avg_agrees,
    avgDisagrees: row.avg_disagrees,
    topics: JSON.parse(row.topics_json) as string[],
    trustScore: row.trust_score,
  };
}

function mapInteractionRow(row: InteractionRow): InteractionRecord {
  return {
    id: row.id,
    ourTxHash: row.our_tx_hash,
    theirTxHash: row.their_tx_hash,
    theirAddress: row.their_address,
    interactionType: row.interaction_type,
    timestamp: row.timestamp,
  };
}

/**
 * Refresh agent profiles by aggregating post and reaction data.
 * When `since` is provided, only posts with timestamp >= since are aggregated
 * (incremental refresh). Returns the number of profiles upserted.
 */
export function refreshAgentProfiles(db: ColonyDatabase, since?: string): number {
  const run = db.transaction(() => {
    if (since) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO agent_profiles
          (address, first_seen_at, last_seen_at, post_count, avg_agrees, avg_disagrees, topics_json, trust_score)
        SELECT
          p.author,
          COALESCE(
            (SELECT ap.first_seen_at FROM agent_profiles ap WHERE ap.address = p.author),
            MIN(p.timestamp)
          ),
          MAX(p.timestamp),
          COUNT(*),
          COALESCE(AVG(rc.agrees), 0),
          COALESCE(AVG(rc.disagrees), 0),
          '[]',
          NULL
        FROM posts p
        LEFT JOIN reaction_cache rc ON rc.post_tx_hash = p.tx_hash
        WHERE p.timestamp >= ?
        GROUP BY p.author
      `);
      const result = stmt.run(since);
      return result.changes;
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO agent_profiles
        (address, first_seen_at, last_seen_at, post_count, avg_agrees, avg_disagrees, topics_json, trust_score)
      SELECT
        p.author,
        MIN(p.timestamp),
        MAX(p.timestamp),
        COUNT(*),
        COALESCE(AVG(rc.agrees), 0),
        COALESCE(AVG(rc.disagrees), 0),
        '[]',
        NULL
      FROM posts p
      LEFT JOIN reaction_cache rc ON rc.post_tx_hash = p.tx_hash
      GROUP BY p.author
    `);
    const result = stmt.run();
    return result.changes;
  });

  return run();
}

/**
 * Record an interaction with another agent.
 */
export function recordInteraction(db: ColonyDatabase, interaction: Omit<InteractionRecord, "id">): void {
  db.prepare(`
    INSERT INTO interactions (our_tx_hash, their_tx_hash, their_address, interaction_type, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    interaction.ourTxHash,
    interaction.theirTxHash,
    interaction.theirAddress,
    interaction.interactionType,
    interaction.timestamp,
  );
}

/**
 * Get an agent's profile by address.
 */
export function getAgentProfile(db: ColonyDatabase, address: string): AgentProfileRecord | null {
  const row = db.prepare("SELECT * FROM agent_profiles WHERE address = ?").get(address) as
    | AgentProfileRow
    | undefined;
  return mapProfileRow(row);
}

/**
 * Query interaction history with optional filters.
 */
export function getInteractionHistory(db: ColonyDatabase, opts?: InteractionFilter): InteractionRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.address) {
    conditions.push("their_address = ?");
    params.push(opts.address);
  }
  if (opts?.type) {
    conditions.push("interaction_type = ?");
    params.push(opts.type);
  }
  if (opts?.since) {
    conditions.push("timestamp >= ?");
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 100;

  const rows = db.prepare(`SELECT * FROM interactions ${where} ORDER BY id DESC LIMIT ?`).all(
    ...params,
    limit,
  ) as InteractionRow[];

  return rows.map(mapInteractionRow);
}
