/**
 * Test quality validator — ensures every test has assertions.
 *
 * Prevents "vibe testing" where AI-generated tests pass but verify nothing.
 * Scans test file source code for it()/test() blocks and checks each
 * contains at least one expect()/assert call.
 *
 * Used by:
 *   - vitest globalSetup (Layer 1: runs during npm test)
 *   - PostToolUse hook (Layer 2: catches at write time)
 *
 * See: https://htek.dev/articles/vibe-testing-when-ai-agents-goodhart-your-test-suite
 */

// ── Types ──────────────────────────────────────────

export interface AssertionlessTest {
  name: string;
  line: number;
}

export interface TestQualityResult {
  file: string;
  pass: boolean;
  testCount: number;
  assertionlessTests: AssertionlessTest[];
}

// ── Patterns ───────────────────────────────────────

// Match it("name", ...) or test("name", ...) but NOT it.skip("name", ...)
const TEST_BLOCK_RE = /\b(?:it|test)\s*\(\s*["'`]([^"'`]+)["'`]/g;
const SKIP_RE = /\b(?:it|test)\.skip\s*\(/;
const ASSERTION_RE = /\bexpect\s*\(|\.assert|assert\.\w+\(|\.toThrow|\.rejects\.|\.resolves\./;

// ── Analysis ───────────────────────────────────────

/**
 * Analyze a test file for assertion density.
 * Returns pass=true if every non-skipped test has at least one assertion.
 */
export function analyzeTestFile(source: string, filePath: string): TestQualityResult {
  const lines = source.split("\n");
  const assertionlessTests: AssertionlessTest[] = [];
  let testCount = 0;

  // Find all test blocks with their positions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip it.skip/test.skip
    if (SKIP_RE.test(line)) continue;

    // Check if this line starts a test block
    TEST_BLOCK_RE.lastIndex = 0;
    const match = TEST_BLOCK_RE.exec(line);
    if (!match) continue;

    const testName = match[1];
    testCount++;

    // Extract the test body — find matching braces
    const body = extractTestBody(lines, i);
    if (body === null || !ASSERTION_RE.test(body)) {
      assertionlessTests.push({ name: testName, line: i + 1 });
    }
  }

  return {
    file: filePath,
    pass: assertionlessTests.length === 0,
    testCount,
    assertionlessTests,
  };
}

/**
 * Extract the body of a test block starting at the given line.
 * Uses brace counting to find the function body.
 */
function extractTestBody(lines: string[], startLine: number): string | null {
  let depth = 0;
  let started = false;
  let bodyStart = -1;
  const bodyLines: string[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];

      // Skip string/template-literal contents (braces inside don't count)
      if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        j++;
        while (j < line.length) {
          if (line[j] === "\\" ) { j++; } // skip escaped char
          else if (line[j] === quote) { break; }
          j++;
        }
        continue;
      }

      // Skip single-line comments
      if (ch === "/" && j + 1 < line.length && line[j + 1] === "/") {
        break; // rest of line is comment
      }

      if (ch === "{") {
        if (!started) {
          started = true;
          bodyStart = j + 1;
        }
        depth++;
      } else if (ch === "}") {
        depth--;
        if (started && depth === 0) {
          // Found the closing brace — extract body
          if (i === startLine) {
            bodyLines.push(line.slice(bodyStart, j));
          } else {
            bodyLines.push(lines[startLine].slice(bodyStart));
            for (let k = startLine + 1; k < i; k++) {
              bodyLines.push(lines[k]);
            }
            bodyLines.push(line.slice(0, j));
          }
          return bodyLines.join("\n");
        }
      }
    }
    // If we started but haven't closed yet, add the whole line
    if (started && i > startLine) {
      // Will be captured in the final extraction
    }
  }

  return null; // Unbalanced braces
}
