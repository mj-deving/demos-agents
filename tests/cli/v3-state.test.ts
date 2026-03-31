import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  CORE_PHASE_ORDER,
  beginPhase,
  completePhase,
  getNextPhase,
  getPhaseOrder,
  isV2,
  isV3,
  normalizeState,
  startSession,
  type SessionState,
  type V2SessionState,
  type V3SessionState,
  validateResumeVersion,
} from "../../src/lib/state.js";

function createV1State(): SessionState {
  return {
    sessionNumber: 11,
    agentName: "sentinel",
    startedAt: "2026-03-31T00:00:00.000Z",
    pid: 1111,
    phases: {
      audit: { status: "pending" },
      scan: { status: "pending" },
      engage: { status: "pending" },
      gate: { status: "pending" },
      publish: { status: "pending" },
      verify: { status: "pending" },
      review: { status: "pending" },
      harden: { status: "pending" },
    },
    posts: [],
    engagements: [],
  };
}

function createV2State(): V2SessionState {
  return {
    loopVersion: 2,
    sessionNumber: 12,
    agentName: "sentinel",
    startedAt: "2026-03-31T00:00:00.000Z",
    pid: 2222,
    phases: {
      sense: { status: "pending" },
      act: { status: "pending" },
      confirm: { status: "pending" },
    },
    substages: [],
    posts: [],
    engagements: [],
  };
}

function createV3State(): V3SessionState {
  return {
    loopVersion: 3,
    sessionNumber: 13,
    agentName: "sentinel",
    startedAt: "2026-03-31T00:00:00.000Z",
    pid: 3333,
    phases: {
      sense: { status: "pending" },
      act: { status: "pending" },
      confirm: { status: "pending" },
    },
    posts: [],
    engagements: [],
  };
}

describe("v3 session state", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isV3 returns true for V3 state and false for V1/V2", () => {
    expect(isV3(createV3State())).toBe(true);
    expect(isV3(createV1State())).toBe(false);
    expect(isV3(createV2State())).toBe(false);
  });

  it("isV2 returns false for V3 state", () => {
    expect(isV2(createV3State())).toBe(false);
  });

  it("startSession with loopVersion 3 creates a V3 session state", () => {
    const sessionsDir = mkdtempSync(resolve(tmpdir(), "v3-state-start-"));
    tmpDirs.push(sessionsDir);

    const state = startSession(1, "sentinel", sessionsDir, 3);

    expect(isV3(state)).toBe(true);
    expect(state).toMatchObject({
      loopVersion: 3,
      sessionNumber: 1,
      agentName: "sentinel",
      pid: process.pid,
      posts: [],
      engagements: [],
    });
    expect(state.startedAt).toBeTruthy();
    expect(state.phases).toEqual({
      sense: { status: "pending" },
      act: { status: "pending" },
      confirm: { status: "pending" },
    });
    expect("substages" in state).toBe(false);
  });

  it("normalizeState fills missing V3 phases", () => {
    const state = {
      ...createV3State(),
      phases: {
        sense: { status: "completed" as const },
      },
    } as unknown as V3SessionState;

    const normalized = normalizeState(state);

    expect(normalized.phases.sense.status).toBe("completed");
    expect(normalized.phases.act).toEqual({ status: "pending" });
    expect(normalized.phases.confirm).toEqual({ status: "pending" });
  });

  it("normalizeState fills missing V3 arrays", () => {
    const state = {
      ...createV3State(),
      posts: undefined,
      engagements: undefined,
      pendingMentions: undefined,
    } as unknown as V3SessionState;

    const normalized = normalizeState(state);

    expect(normalized.posts).toEqual([]);
    expect(normalized.engagements).toEqual([]);
    expect(normalized.pendingMentions).toEqual([]);
  });

  it("getNextPhase returns the first non-completed core phase for V3", () => {
    const state: V3SessionState = {
      ...createV3State(),
      phases: {
        sense: { status: "completed" },
        act: { status: "failed" },
        confirm: { status: "pending" },
      },
    };

    expect(getNextPhase(state)).toBe("act");
  });

  it("getPhaseOrder returns core phase order for V3", () => {
    expect(getPhaseOrder(createV3State())).toEqual(CORE_PHASE_ORDER);
  });

  it("validateResumeVersion passes when versions match", () => {
    expect(() => validateResumeVersion(createV3State(), 3)).not.toThrow();
    expect(() => validateResumeVersion(createV2State(), 2)).not.toThrow();
  });

  it("validateResumeVersion throws when resuming a V2 session as V3", () => {
    expect(() => validateResumeVersion(createV2State(), 3)).toThrow(
      "Cannot resume session 12: session is V2 but --loop-version 3 was requested. Use --loop-version 2 to resume, or start a new session."
    );
  });

  it("validateResumeVersion throws when resuming a V3 session as V2", () => {
    expect(() => validateResumeVersion(createV3State(), 2)).toThrow(
      "Cannot resume session 13: session is V3 but --loop-version 2 was requested. Use --loop-version 3 to resume, or start a new session."
    );
  });

  it("beginPhase and completePhase work with V3 state", () => {
    const sessionsDir = mkdtempSync(resolve(tmpdir(), "v3-state-phase-"));
    tmpDirs.push(sessionsDir);

    const state = startSession(2, "sentinel", sessionsDir, 3);
    if (!isV3(state)) throw new Error("Expected V3 state");

    beginPhase(state, "sense", sessionsDir);
    expect(state.phases.sense.status).toBe("in_progress");
    expect(state.phases.sense.startedAt).toBeTruthy();

    completePhase(state, "sense", { ok: true }, sessionsDir);
    expect(state.phases.sense.status).toBe("completed");
    expect(state.phases.sense.completedAt).toBeTruthy();
    expect(state.phases.sense.result).toEqual({ ok: true });
  });
});
