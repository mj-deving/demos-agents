export interface ResearchEvidenceDeltaEntry {
  current: string;
  previous: string | null;
  absoluteChange: number | null;
  percentChange: number | null;
}

export interface ResearchEvidenceDeltaSummary {
  hasMeaningfulChange: boolean;
  changedFields: string[];
}

const DEFAULT_MIN_MEANINGFUL_PERCENT_DELTA = 1;
const DEFAULT_MIN_MEANINGFUL_ABSOLUTE_DELTA = 0.001;

export function buildResearchEvidenceDelta(
  previous: Record<string, string> | null | undefined,
  current: Record<string, string>,
): Record<string, ResearchEvidenceDeltaEntry> {
  const delta: Record<string, ResearchEvidenceDeltaEntry> = {};

  for (const [key, currentValue] of Object.entries(current)) {
    const previousValue = previous?.[key] ?? null;
    const currentNumber = parseNumeric(currentValue);
    const previousNumber = parseNumeric(previousValue);
    const absoluteChange = currentNumber != null && previousNumber != null
      ? currentNumber - previousNumber
      : null;
    const percentChange = absoluteChange != null && previousNumber != null && previousNumber !== 0
      ? (absoluteChange / Math.abs(previousNumber)) * 100
      : null;

    delta[key] = {
      current: currentValue,
      previous: previousValue,
      absoluteChange,
      percentChange,
    };
  }

  return delta;
}

export function summarizeResearchEvidenceDelta(
  delta: Record<string, ResearchEvidenceDeltaEntry>,
  {
    minMeaningfulPercentDelta = DEFAULT_MIN_MEANINGFUL_PERCENT_DELTA,
    minMeaningfulAbsoluteDelta = DEFAULT_MIN_MEANINGFUL_ABSOLUTE_DELTA,
  }: {
    minMeaningfulPercentDelta?: number;
    minMeaningfulAbsoluteDelta?: number;
  } = {},
): ResearchEvidenceDeltaSummary {
  const changedFields = Object.entries(delta)
    .filter(([, value]) =>
      isMeaningfulDelta(value.absoluteChange, value.percentChange, {
        minMeaningfulPercentDelta,
        minMeaningfulAbsoluteDelta,
      }))
    .map(([key]) => key);

  return {
    hasMeaningfulChange: changedFields.length > 0,
    changedFields,
  };
}

function parseNumeric(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isMeaningfulDelta(
  absoluteChange: number | null,
  percentChange: number | null,
  {
    minMeaningfulPercentDelta,
    minMeaningfulAbsoluteDelta,
  }: {
    minMeaningfulPercentDelta: number;
    minMeaningfulAbsoluteDelta: number;
  },
): boolean {
  if (percentChange != null) {
    return Math.abs(percentChange) >= minMeaningfulPercentDelta;
  }
  if (absoluteChange == null) return false;
  return Math.abs(absoluteChange) >= minMeaningfulAbsoluteDelta;
}
