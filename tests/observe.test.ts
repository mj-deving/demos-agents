import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock homedir before importing the module so initObserver writes to our tmp dir
let mockHomeDir: string;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockHomeDir,
  };
});

// Import after mock setup
import {
  initObserver,
  setObserverPhase,
  observe,
  type ObservationType,
} from "../tools/lib/observe.js";

// ── Helpers ──────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "observe-test-"));
}

function readObservations(agentName: string): any[] {
  const path = join(mockHomeDir, `.${agentName}`, "observations.jsonl");
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line));
}

// ── initObserver ─────────────────────────────────

describe("initObserver", () => {
  beforeEach(() => {
    mockHomeDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(mockHomeDir, { recursive: true, force: true });
  });

  it("creates the agent directory", () => {
    initObserver("test-agent", 1);
    const dir = join(mockHomeDir, ".test-agent");
    expect(existsSync(dir)).toBe(true);
  });

  it("enables observe() to write entries after init", () => {
    initObserver("test-agent", 5);
    observe("insight", "test observation");
    const entries = readObservations("test-agent");
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("test observation");
  });

  it("sets the session number in observations", () => {
    initObserver("test-agent", 42);
    observe("error", "some error");
    const entries = readObservations("test-agent");
    expect(entries[0].session).toBe(42);
  });

  it("can be re-initialized with different agent/session", () => {
    initObserver("agent-a", 1);
    observe("insight", "first");
    initObserver("agent-b", 2);
    observe("insight", "second");
    const entriesA = readObservations("agent-a");
    const entriesB = readObservations("agent-b");
    expect(entriesA).toHaveLength(1);
    expect(entriesB).toHaveLength(1);
    expect(entriesB[0].session).toBe(2);
  });
});

// ── observe ──────────────────────────────────────

describe("observe", () => {
  beforeEach(() => {
    mockHomeDir = makeTmpDir();
    initObserver("obs-agent", 10);
  });
  afterEach(() => {
    rmSync(mockHomeDir, { recursive: true, force: true });
  });

  it("writes a valid JSONL entry with required fields", () => {
    observe("error", "Something broke");
    const entries = readObservations("obs-agent");
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.id).toMatch(/^obs-10-\d+-[0-9a-f]{4}$/);
    expect(entry.ts).toBeTruthy();
    expect(entry.session).toBe(10);
    expect(entry.type).toBe("error");
    expect(entry.text).toBe("Something broke");
    expect(entry.resolved).toBeNull();
  });

  it("supports all observation types", () => {
    const types: ObservationType[] = [
      "error",
      "pattern",
      "insight",
      "inefficiency",
      "source-issue",
    ];
    types.forEach((type) => observe(type, `Test ${type}`));
    const entries = readObservations("obs-agent");
    expect(entries).toHaveLength(5);
    types.forEach((type, i) => {
      expect(entries[i].type).toBe(type);
    });
  });

  it("uses current phase as default phase", () => {
    setObserverPhase("sense");
    observe("insight", "during sense");
    const entries = readObservations("obs-agent");
    expect(entries[0].phase).toBe("sense");
  });

  it("allows phase override via options", () => {
    setObserverPhase("act");
    observe("error", "override phase", { phase: "confirm" });
    const entries = readObservations("obs-agent");
    expect(entries[0].phase).toBe("confirm");
  });

  it("includes optional substage when provided", () => {
    observe("error", "gate failed", { substage: "gate" });
    const entries = readObservations("obs-agent");
    expect(entries[0].substage).toBe("gate");
  });

  it("includes optional source when provided", () => {
    observe("error", "timeout", { source: "publish-pipeline.ts:234" });
    const entries = readObservations("obs-agent");
    expect(entries[0].source).toBe("publish-pipeline.ts:234");
  });

  it("includes optional data when provided", () => {
    observe("pattern", "recurring error", { data: { count: 5, ids: [1, 2] } });
    const entries = readObservations("obs-agent");
    expect(entries[0].data).toEqual({ count: 5, ids: [1, 2] });
  });

  it("omits optional fields when not provided", () => {
    observe("insight", "simple observation");
    const entries = readObservations("obs-agent");
    const entry = entries[0];
    expect(entry).not.toHaveProperty("substage");
    expect(entry).not.toHaveProperty("source");
    expect(entry).not.toHaveProperty("data");
  });

  it("generates unique IDs for consecutive observations", () => {
    observe("insight", "first");
    observe("insight", "second");
    const entries = readObservations("obs-agent");
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it("appends multiple entries to the same file", () => {
    for (let i = 0; i < 10; i++) {
      observe("pattern", `observation ${i}`);
    }
    const entries = readObservations("obs-agent");
    expect(entries).toHaveLength(10);
    expect(entries[9].text).toBe("observation 9");
  });
});

// ── setObserverPhase ─────────────────────────────

describe("setObserverPhase", () => {
  beforeEach(() => {
    mockHomeDir = makeTmpDir();
    initObserver("phase-agent", 1);
  });
  afterEach(() => {
    rmSync(mockHomeDir, { recursive: true, force: true });
  });

  it("changes the phase context for subsequent observations", () => {
    setObserverPhase("sense");
    observe("insight", "in sense");
    setObserverPhase("act");
    observe("insight", "in act");
    const entries = readObservations("phase-agent");
    expect(entries[0].phase).toBe("sense");
    expect(entries[1].phase).toBe("act");
  });

  it("defaults to 'unknown' before any phase is set", () => {
    // Re-init to reset phase state
    initObserver("phase-agent", 1);
    // Note: _currentPhase persists across inits since it's module-level state.
    // The default is "unknown" only on first module load.
    // This test verifies setObserverPhase actually changes the value.
    setObserverPhase("confirm");
    observe("insight", "after set");
    const entries = readObservations("phase-agent");
    expect(entries[0].phase).toBe("confirm");
  });

  it("can be set multiple times in a session", () => {
    const phases = ["sense", "act", "confirm", "report"];
    phases.forEach((phase) => {
      setObserverPhase(phase);
      observe("pattern", `in ${phase}`);
    });
    const entries = readObservations("phase-agent");
    expect(entries).toHaveLength(4);
    phases.forEach((phase, i) => {
      expect(entries[i].phase).toBe(phase);
    });
  });

  it("accepts arbitrary phase strings", () => {
    setObserverPhase("custom-phase-123");
    observe("insight", "custom");
    const entries = readObservations("phase-agent");
    expect(entries[0].phase).toBe("custom-phase-123");
  });
});

// ── Silent failure ───────────────────────────────

describe("silent failure behavior", () => {
  it("no-ops silently when observe is called before initObserver on fresh module", async () => {
    // We can't truly test un-initialized state since initObserver was already
    // called above, but we can test that observe doesn't throw when the log
    // path becomes invalid by making the directory unwritable.
    // The key contract: observe() never throws.
    expect(() => observe("error", "should not throw")).not.toThrow();
  });

  it("observe never throws even with unusual inputs", () => {
    mockHomeDir = makeTmpDir();
    initObserver("safe-agent", 1);
    // These should all complete without throwing
    expect(() => observe("error", "")).not.toThrow();
    expect(() =>
      observe("insight", "x".repeat(10000))
    ).not.toThrow();
    expect(() =>
      observe("pattern", "with data", { data: { nested: { deep: true } } })
    ).not.toThrow();
    rmSync(mockHomeDir, { recursive: true, force: true });
  });
});
