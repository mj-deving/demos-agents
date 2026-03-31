import { getSourceResponse } from "./source-cache.js";
import type { ColonyDatabase } from "./schema.js";

export interface AvailableEvidence {
  sourceId: string;
  subject: string;
  metrics: string[];
  richness: number;
  freshness: number;
  stale: boolean;
}

export function computeAvailableEvidence(
  db: ColonyDatabase,
  catalogSources: Array<{ id: string; topics: string[]; domainTags: string[] }>,
  now = new Date(),
): AvailableEvidence[] {
  const evidence: AvailableEvidence[] = [];

  for (const source of catalogSources) {
    const cached = getSourceResponse(db, source.id);
    if (!cached) continue;
    if (cached.consecutiveFailures >= 3) continue;
    if (cached.responseStatus < 200 || cached.responseStatus >= 300) continue;

    const freshness = Math.max(0, Math.floor((now.getTime() - Date.parse(cached.lastFetchedAt)) / 1000));
    if (freshness > cached.ttlSeconds) continue;

    evidence.push({
      sourceId: source.id,
      subject: source.topics[0] ?? source.id,
      metrics: [...source.domainTags],
      richness: cached.responseSize,
      freshness,
      stale: false,
    });
  }

  return evidence.sort((left, right) =>
    left.freshness - right.freshness
    || right.richness - left.richness
    || left.sourceId.localeCompare(right.sourceId)
  );
}
