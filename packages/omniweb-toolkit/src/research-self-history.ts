export interface ResearchPublishHistoryEntry {
  topic: string;
  family: string | null;
  publishedAt: string;
  opportunityKind: string;
  textSnippet: string | null;
  evidenceValues: Record<string, string>;
}

export interface ResearchSelfHistoryPostSummary {
  topic: string;
  family: string | null;
  publishedAt: string;
  hoursAgo: number;
  textSnippet: string | null;
}

export interface ResearchSelfHistoryDelta {
  comparedToPublishedAt: string;
  changedFields: string[];
  hasMeaningfulChange: boolean;
}

export interface ResearchSelfHistorySummary {
  lastPost: ResearchSelfHistoryPostSummary | null;
  lastSameTopicPost: ResearchSelfHistoryPostSummary | null;
  lastSameFamilyPost: ResearchSelfHistoryPostSummary | null;
  windows: {
    total24h: number;
    total7d: number;
    sameTopic24h: number;
    sameTopic7d: number;
    sameFamily24h: number;
    sameFamily7d: number;
  };
  changeSinceLastSameTopic: ResearchSelfHistoryDelta | null;
  changeSinceLastSameFamily: ResearchSelfHistoryDelta | null;
  repeatRisk: "low" | "medium" | "high";
  skipSuggested: boolean;
  repetitionReason: string | null;
}

export interface BuildResearchSelfHistoryOptions {
  history: ResearchPublishHistoryEntry[];
  topic: string;
  family: string | null;
  now: string;
  currentEvidenceValues: Record<string, string>;
  minMeaningfulPercentDelta?: number;
  minMeaningfulAbsoluteDelta?: number;
}

const DEFAULT_MIN_MEANINGFUL_PERCENT_DELTA = 1;
const DEFAULT_MIN_MEANINGFUL_ABSOLUTE_DELTA = 0.001;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function buildResearchSelfHistory(opts: BuildResearchSelfHistoryOptions): ResearchSelfHistorySummary {
  const nowMs = Date.parse(opts.now);
  const minMeaningfulPercentDelta = opts.minMeaningfulPercentDelta ?? DEFAULT_MIN_MEANINGFUL_PERCENT_DELTA;
  const minMeaningfulAbsoluteDelta = opts.minMeaningfulAbsoluteDelta ?? DEFAULT_MIN_MEANINGFUL_ABSOLUTE_DELTA;
  const sortedHistory = [...opts.history]
    .filter((entry) => typeof entry.topic === "string" && entry.topic.length > 0 && typeof entry.publishedAt === "string")
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

  const lastPost = sortedHistory[0] ? summarizePost(sortedHistory[0], nowMs) : null;
  const lastSameTopic = sortedHistory.find((entry) => normalize(entry.topic) === normalize(opts.topic)) ?? null;
  const lastSameFamily = opts.family == null
    ? null
    : sortedHistory.find((entry) => normalize(entry.family) === normalize(opts.family)) ?? null;

  const windows = {
    total24h: countSince(sortedHistory, nowMs, DAY_MS),
    total7d: countSince(sortedHistory, nowMs, WEEK_MS),
    sameTopic24h: countSince(sortedHistory.filter((entry) => normalize(entry.topic) === normalize(opts.topic)), nowMs, DAY_MS),
    sameTopic7d: countSince(sortedHistory.filter((entry) => normalize(entry.topic) === normalize(opts.topic)), nowMs, WEEK_MS),
    sameFamily24h: countSince(sortedHistory.filter((entry) => normalize(entry.family) === normalize(opts.family)), nowMs, DAY_MS),
    sameFamily7d: countSince(sortedHistory.filter((entry) => normalize(entry.family) === normalize(opts.family)), nowMs, WEEK_MS),
  };

  const changeSinceLastSameTopic = lastSameTopic
    ? buildDelta(lastSameTopic, opts.currentEvidenceValues, minMeaningfulAbsoluteDelta, minMeaningfulPercentDelta)
    : null;
  const changeSinceLastSameFamily = lastSameFamily
    ? buildDelta(lastSameFamily, opts.currentEvidenceValues, minMeaningfulAbsoluteDelta, minMeaningfulPercentDelta)
    : null;

  let repeatRisk: ResearchSelfHistorySummary["repeatRisk"] = "low";
  let skipSuggested = false;
  let repetitionReason: string | null = null;
  const lastSameTopicSummary = lastSameTopic ? summarizePost(lastSameTopic, nowMs) : null;
  const lastSameFamilySummary = lastSameFamily ? summarizePost(lastSameFamily, nowMs) : null;

  if (lastSameTopicSummary && changeSinceLastSameTopic && !changeSinceLastSameTopic.hasMeaningfulChange && lastSameTopicSummary.hoursAgo <= 24 * 7) {
    repeatRisk = "high";
    skipSuggested = true;
    repetitionReason = "same_topic_no_material_change_within_7d";
  } else if (lastSameFamilySummary && changeSinceLastSameFamily && !changeSinceLastSameFamily.hasMeaningfulChange && lastSameFamilySummary.hoursAgo <= 24) {
    repeatRisk = "high";
    skipSuggested = true;
    repetitionReason = "same_family_no_material_change_within_24h";
  } else if (windows.sameFamily24h > 0 || windows.sameTopic7d > 1) {
    repeatRisk = "medium";
    repetitionReason = windows.sameFamily24h > 0
      ? "recent_same_family_coverage"
      : "recent_same_topic_coverage";
  }

  return {
    lastPost,
    lastSameTopicPost: lastSameTopicSummary,
    lastSameFamilyPost: lastSameFamilySummary,
    windows,
    changeSinceLastSameTopic,
    changeSinceLastSameFamily,
    repeatRisk,
    skipSuggested,
    repetitionReason,
  };
}

function summarizePost(entry: ResearchPublishHistoryEntry, nowMs: number): ResearchSelfHistoryPostSummary {
  return {
    topic: entry.topic,
    family: entry.family,
    publishedAt: entry.publishedAt,
    hoursAgo: Number((((nowMs - Date.parse(entry.publishedAt)) / (60 * 60 * 1000))).toFixed(2)),
    textSnippet: entry.textSnippet ?? null,
  };
}

function countSince(history: ResearchPublishHistoryEntry[], nowMs: number, windowMs: number): number {
  return history.filter((entry) => {
    const publishedAtMs = Date.parse(entry.publishedAt);
    return Number.isFinite(publishedAtMs) && nowMs - publishedAtMs <= windowMs;
  }).length;
}

function buildDelta(
  entry: ResearchPublishHistoryEntry,
  currentEvidenceValues: Record<string, string>,
  minMeaningfulAbsoluteDelta: number,
  minMeaningfulPercentDelta: number,
): ResearchSelfHistoryDelta {
  const changedFields = Object.entries(currentEvidenceValues)
    .filter(([key, currentValue]) => isMeaningfulDelta(entry.evidenceValues[key] ?? null, currentValue, minMeaningfulAbsoluteDelta, minMeaningfulPercentDelta))
    .map(([key]) => key);

  return {
    comparedToPublishedAt: entry.publishedAt,
    changedFields,
    hasMeaningfulChange: changedFields.length > 0,
  };
}

function isMeaningfulDelta(
  previousValue: string | null,
  currentValue: string,
  minMeaningfulAbsoluteDelta: number,
  minMeaningfulPercentDelta: number,
): boolean {
  const currentNumber = parseNumeric(currentValue);
  const previousNumber = parseNumeric(previousValue);
  if (currentNumber == null || previousNumber == null) {
    return previousValue !== currentValue;
  }
  const absoluteChange = Math.abs(currentNumber - previousNumber);
  if (absoluteChange >= minMeaningfulAbsoluteDelta) return true;
  if (previousNumber === 0) return absoluteChange > 0;
  const percentChange = (absoluteChange / Math.abs(previousNumber)) * 100;
  return percentChange >= minMeaningfulPercentDelta;
}

function parseNumeric(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
