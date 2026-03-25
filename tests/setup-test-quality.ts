/**
 * Vitest globalSetup — test quality gate.
 *
 * Runs BEFORE all tests. Scans every test file for assertion-free tests
 * and fails the entire suite if any are found. This prevents "vibe testing"
 * where AI-generated tests pass but verify nothing.
 *
 * Enforcement: This file cannot be bypassed by the AI since it runs as
 * part of vitest infrastructure, not as a test itself.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeTestFile } from "../src/lib/test-quality-validator.js";

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

export async function setup() {
  const testFiles = findTestFiles(resolve("tests"));
  const failures: string[] = [];

  for (const file of testFiles) {
    // Skip the validator's own test (it intentionally contains test code strings)
    if (file.includes("test-quality-validator")) continue;

    const source = readFileSync(resolve(file), "utf8");
    const result = analyzeTestFile(source, file);

    if (!result.pass) {
      for (const t of result.assertionlessTests) {
        failures.push(`  ${file}:${t.line} — "${t.name}" has no assertions`);
      }
    }
  }

  if (failures.length > 0) {
    const msg = [
      "",
      "╔══════════════════════════════════════════════════╗",
      "║  TEST QUALITY GATE FAILED — assertion-free tests ║",
      "╚══════════════════════════════════════════════════╝",
      "",
      ...failures,
      "",
      `${failures.length} test(s) have no expect()/assert calls.`,
      "Every test must verify behavior, not just execute code.",
      "See: src/lib/test-quality-validator.ts",
      "",
    ].join("\n");
    throw new Error(msg);
  }
}
