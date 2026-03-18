/**
 * Response validator — detects fake, empty, or malformed API responses.
 *
 * Addresses the SD-1 (Skill-Dojo) fake data problem where API responses
 * contain placeholder text, empty fields, or suspiciously uniform data.
 *
 * Usage:
 *   const result = validateResponse(apiResponse);
 *   if (!result.pass) warn(`Invalid response: ${result.reasons.join(", ")}`);
 */

// ── Types ──────────────────────────────────────────

export interface ValidationResult {
  /** Whether the response passes all checks */
  pass: boolean;
  /** Human-readable reasons for failure (empty if pass is true) */
  reasons: string[];
  /** Number of checks that passed */
  checksRun: number;
  /** Number of checks that failed */
  checksFailed: number;
}

export interface ValidatorOptions {
  /** Minimum non-empty string fields required (default: 1) */
  minNonEmptyFields?: number;
  /** Custom fake text patterns to detect (added to defaults) */
  extraFakePatterns?: RegExp[];
  /** Skip specific checks by name */
  skipChecks?: string[];
}

// ── Fake Data Patterns ─────────────────────────────

/**
 * Known fake/placeholder text patterns found in API responses.
 * These indicate the API is returning stub data, not real content.
 */
const DEFAULT_FAKE_PATTERNS: RegExp[] = [
  /^lorem ipsum/i,
  /^test\s*(data|post|content|entry)/i,
  /^sample\s*(data|post|content|entry|text)/i,
  /^placeholder/i,
  /^foo\s*bar/i,
  /^TODO/,
  /^TBD$/i,
  /^N\/A$/i,
  /^null$/i,
  /^undefined$/i,
  /^example\s*(data|post|content|text)/i,
  /^\[?insert\s/i,
  /^dummy/i,
];

// ── Validators ─────────────────────────────────────

function checkNotNull(data: unknown): string | null {
  if (data === null || data === undefined) {
    return "Response data is null or undefined";
  }
  return null;
}

function checkNotEmpty(data: unknown): string | null {
  if (typeof data === "string" && data.trim().length === 0) {
    return "Response data is an empty string";
  }
  if (Array.isArray(data) && data.length === 0) {
    return "Response data is an empty array";
  }
  if (typeof data === "object" && data !== null && Object.keys(data).length === 0) {
    return "Response data is an empty object";
  }
  return null;
}

function checkStringFieldsPresent(data: unknown, minFields: number): string | null {
  if (typeof data !== "object" || data === null) return null;
  // Skip check for arrays — items are validated individually by other checks
  if (Array.isArray(data)) return null;

  const obj = data as Record<string, unknown>;
  let nonEmptyCount = 0;

  for (const value of Object.values(obj)) {
    if (typeof value === "string" && value.trim().length > 0) {
      nonEmptyCount++;
    }
  }

  if (nonEmptyCount < minFields) {
    return `Only ${nonEmptyCount} non-empty string field(s) found, need at least ${minFields}`;
  }
  return null;
}

function checkFakePatterns(data: unknown, patterns: RegExp[]): string | null {
  const textsToCheck: string[] = [];

  if (typeof data === "string") {
    textsToCheck.push(data);
  } else if (typeof data === "object" && data !== null) {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (typeof value === "string") {
        textsToCheck.push(value);
      }
    }
  }

  for (const text of textsToCheck) {
    const trimmed = text.trim();
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return `Fake data pattern detected: "${trimmed.slice(0, 50)}" matches ${pattern}`;
      }
    }
  }
  return null;
}

function checkArrayItemsNotUniform(data: unknown): string | null {
  if (!Array.isArray(data) || data.length < 3) return null;

  // Short-circuit: compare each item against the first, exit on first difference
  const first = JSON.stringify(data[0]);
  for (let i = 1; i < data.length; i++) {
    if (JSON.stringify(data[i]) !== first) return null;
  }
  return `All ${data.length} array items are identical — likely fake data`;
}

// ── Main Validator ─────────────────────────────────

/**
 * Validate an API response for fake, empty, or malformed data.
 *
 * Runs a battery of checks and returns a structured result.
 * Designed to be used defensively before trusting API data.
 */
export function validateResponse(
  data: unknown,
  options: ValidatorOptions = {},
): ValidationResult {
  const {
    minNonEmptyFields = 1,
    extraFakePatterns = [],
    skipChecks = [],
  } = options;

  const allPatterns = [...DEFAULT_FAKE_PATTERNS, ...extraFakePatterns];
  const skip = new Set(skipChecks);

  const checks: Array<[string, () => string | null]> = [
    ["notNull", () => checkNotNull(data)],
    ["notEmpty", () => checkNotEmpty(data)],
    ["stringFields", () => checkStringFieldsPresent(data, minNonEmptyFields)],
    ["fakePatterns", () => checkFakePatterns(data, allPatterns)],
    ["uniformArray", () => checkArrayItemsNotUniform(data)],
  ];

  const reasons: string[] = [];
  let checksRun = 0;

  for (const [name, check] of checks) {
    if (skip.has(name)) continue;
    checksRun++;
    const reason = check();
    if (reason) reasons.push(reason);
  }

  return {
    pass: reasons.length === 0,
    reasons,
    checksRun,
    checksFailed: reasons.length,
  };
}
