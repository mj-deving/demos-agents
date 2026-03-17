/**
 * Tests for LLM reasoning fallback in topic selection.
 *
 * Since suggestTopicsWithReasoning is internal to session-runner.ts and uses
 * module-scoped state (agentConfig, getScanResult), we test the contract via
 * source inspection + the helper functions it depends on.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("suggestTopicsWithReasoning — source contract", () => {
  const source = readFileSync("tools/session-runner.ts", "utf-8");

  it("function exists and is async", () => {
    expect(source).toMatch(/async function suggestTopicsWithReasoning\(/);
  });

  it("calls resolveProvider for LLM access", () => {
    expect(source).toMatch(/resolveProvider\(flags\.env\)/);
  });

  it("builds prompt with feed topics, source topics, and agent focus", () => {
    expect(source).toMatch(/feedTopics|Feed hot topics/);
    expect(source).toMatch(/availableSources|available data source/i);
    expect(source).toMatch(/agentFocus|agent.*focus/i);
  });

  it("validates suggestions with sourcesPreflight before returning", () => {
    // The function calls sourcesPreflight on each LLM suggestion
    const fnBody = source.slice(
      source.indexOf("async function suggestTopicsWithReasoning"),
      source.indexOf("/** GATE: autonomous oversight")
    );
    expect(fnBody).toMatch(/sourcesPreflight\(topic/);
  });

  it("returns empty array on LLM failure (non-fatal)", () => {
    const fnBody = source.slice(
      source.indexOf("async function suggestTopicsWithReasoning"),
      source.indexOf("/** GATE: autonomous oversight")
    );
    expect(fnBody).toMatch(/catch.*\{/s);
    expect(fnBody).toMatch(/return \[\]/);
  });

  it("returns empty array when no LLM provider available", () => {
    const fnBody = source.slice(
      source.indexOf("async function suggestTopicsWithReasoning"),
      source.indexOf("/** GATE: autonomous oversight")
    );
    expect(fnBody).toMatch(/no LLM provider.*return \[\]/s);
  });

  it("is called from runGateAutonomous when heuristics return 0", () => {
    const gateBody = source.slice(
      source.indexOf("async function runGateAutonomous"),
      source.indexOf("// ── PUBLISH Phase")
    );
    // Called when extractTopicsFromScan returns 0
    expect(gateBody).toMatch(/suggestTopicsWithReasoning\(state, sourceView, flags\)/);
  });

  it("is called from runGateAutonomous when all heuristic topics fail gate", () => {
    const gateBody = source.slice(
      source.indexOf("async function runGateAutonomous"),
      source.indexOf("// ── PUBLISH Phase")
    );
    // Called after gate loop when gatePosts.length === 0
    expect(gateBody).toMatch(/All heuristic topics failed gate.*reasoning/s);
    expect(gateBody).toMatch(/suggestTopicsWithReasoning/);
  });

  it("parses LLM response as JSON array with topic and reason fields", () => {
    const fnBody = source.slice(
      source.indexOf("async function suggestTopicsWithReasoning"),
      source.indexOf("/** GATE: autonomous oversight")
    );
    expect(fnBody).toMatch(/JSON\.parse/);
    expect(fnBody).toMatch(/item\.topic/);
    expect(fnBody).toMatch(/item\.reason/);
  });

  it("limits to 3 suggestions max", () => {
    const fnBody = source.slice(
      source.indexOf("async function suggestTopicsWithReasoning"),
      source.indexOf("/** GATE: autonomous oversight")
    );
    expect(fnBody).toMatch(/\.slice\(0,\s*3\)/);
  });
});
