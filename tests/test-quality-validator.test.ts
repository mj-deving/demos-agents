/**
 * Tests for the test quality validator — ensures every test has assertions.
 *
 * The validator scans test files for it()/test() blocks and verifies
 * each contains at least one expect() call. Prevents "vibe testing"
 * where AI-generated tests pass but verify nothing.
 */

import { describe, it, expect } from "vitest";
import { analyzeTestFile, type TestQualityResult } from "../src/lib/test-quality-validator.js";

describe("analyzeTestFile", () => {
  it("passes for test with assertions", () => {
    const code = `
      describe("math", () => {
        it("adds numbers", () => {
          expect(1 + 1).toBe(2);
        });
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
    expect(result.assertionlessTests).toHaveLength(0);
  });

  it("fails for test without assertions", () => {
    const code = `
      describe("math", () => {
        it("adds numbers", () => {
          const result = 1 + 1;
        });
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(false);
    expect(result.assertionlessTests).toHaveLength(1);
    expect(result.assertionlessTests[0].name).toBe("adds numbers");
  });

  it("fails for empty test body", () => {
    const code = `
      it("does nothing", () => {});
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(false);
    expect(result.assertionlessTests).toHaveLength(1);
  });

  it("passes for test() alias with assertions", () => {
    const code = `
      test("works", () => {
        expect(true).toBe(true);
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
  });

  it("handles multiple tests with mixed assertion presence", () => {
    const code = `
      describe("suite", () => {
        it("has assertion", () => {
          expect(1).toBe(1);
        });
        it("no assertion", () => {
          console.log("hello");
        });
        it("also has assertion", () => {
          expect(2).toBe(2);
        });
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(false);
    expect(result.testCount).toBe(3);
    expect(result.assertionlessTests).toHaveLength(1);
    expect(result.assertionlessTests[0].name).toBe("no assertion");
  });

  it("counts assert() as valid assertion (node:assert)", () => {
    const code = `
      it("uses node assert", () => {
        assert.strictEqual(1, 1);
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
  });

  it("handles nested describe blocks", () => {
    const code = `
      describe("outer", () => {
        describe("inner", () => {
          it("nested test", () => {
            expect(true).toBe(true);
          });
        });
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
  });

  it("ignores skipped tests", () => {
    const code = `
      it.skip("skipped", () => {});
      it("active", () => {
        expect(1).toBe(1);
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
  });

  it("returns file path in result", () => {
    const code = `it("test", () => { expect(1).toBe(1); });`;
    const result = analyzeTestFile(code, "tests/foo.test.ts");
    expect(result.file).toBe("tests/foo.test.ts");
  });

  it("ignores braces inside string test names", () => {
    const code = `
      it("returns { rotated: false, archived: 0 } for missing file", () => {
        const result = doSomething();
        expect(result.rotated).toBe(false);
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
  });

  it("ignores braces inside template literal test names", () => {
    const code = [
      'for (const agent of ["a", "b"]) {',
      "  it(`\${agent}: resolveLogPath includes agent name`, () => {",
      "    const logPath = resolveLogPath(undefined, agent);",
      "    expect(logPath).toContain(agent);",
      "  });",
      "}",
    ].join("\n");
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
  });

  it("ignores braces in comments within test body", () => {
    const code = `
      it("handles gracefully", () => {
        // This { brace } should be ignored
        const result = doSomething();
        expect(result).toBeDefined();
      });
    `;
    const result = analyzeTestFile(code, "test.ts");
    expect(result.pass).toBe(true);
    expect(result.testCount).toBe(1);
  });
});
