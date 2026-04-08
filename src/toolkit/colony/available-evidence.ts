import { getSourceResponse } from "./source-cache.js";
import type { ColonyDatabase } from "./schema.js";

const CIRCUIT_BREAKER_THRESHOLD = 3;
const RICHNESS_ANCHORS = [
  { bytes: 0, score: 0 },
  { bytes: 100, score: 30 },
  { bytes: 500, score: 60 },
  { bytes: 2000, score: 80 },
  { bytes: 5000, score: 95 },
] as const;

export interface AvailableEvidence {
  sourceId: string;
  subject: string;
  metrics: string[];
  richness: number;
  freshness: number;
  stale: boolean;
}

function normalizeResponseSizeToRichness(responseSize: number): number {
  if (responseSize <= 0) return 0;

  const cappedResponseSize = Math.min(responseSize, RICHNESS_ANCHORS[RICHNESS_ANCHORS.length - 1].bytes);

  for (let index = 1; index < RICHNESS_ANCHORS.length; index++) {
    const lower = RICHNESS_ANCHORS[index - 1];
    const upper = RICHNESS_ANCHORS[index];

    if (cappedResponseSize > upper.bytes) continue;

    const lowerBytes = Math.max(1, lower.bytes);
    const ratio = (Math.log(cappedResponseSize) - Math.log(lowerBytes))
      / (Math.log(upper.bytes) - Math.log(lowerBytes));
    const interpolatedScore = lower.score + ratio * (upper.score - lower.score);

    return Math.min(100, Math.round(interpolatedScore));
  }

  return RICHNESS_ANCHORS[RICHNESS_ANCHORS.length - 1].score;
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
    if (cached.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) continue;
    if (cached.responseStatus < 200 || cached.responseStatus >= 300) continue;

    const freshness = Math.max(0, Math.floor((now.getTime() - Date.parse(cached.lastFetchedAt)) / 1000));
    if (freshness > cached.ttlSeconds) continue;

    // Index by all topics and domain tags — not just topics[0]
    // so gap topic tokens like "bitcoin" match source topics ["crypto", "bitcoin"]
    const subjects = new Set<string>();
    for (const t of source.topics) subjects.add(t.toLowerCase());
    for (const t of source.domainTags) subjects.add(t.toLowerCase());
    if (subjects.size === 0) subjects.add(source.id);

    for (const subject of subjects) {
      evidence.push({
        sourceId: source.id,
        subject,
        metrics: [...source.domainTags],
        richness: normalizeResponseSizeToRichness(cached.responseSize),
        freshness,
        stale: false,
      });
    }
  }

  return evidence.sort((left, right) =>
    left.freshness - right.freshness
    || right.richness - left.richness
    || left.sourceId.localeCompare(right.sourceId)
  );
}
