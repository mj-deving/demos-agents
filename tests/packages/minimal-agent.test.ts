import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultMinimalStateDir,
  runMinimalAgentCycle,
  runMinimalAgentLoop,
} from "../../packages/omniweb-toolkit/src/minimal-agent.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "minimal-agent-"));
  tempDirs.push(dir);
  return dir;
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf-8"));
}

function makeNow(...values: number[]): () => number {
  const queue = [...values];
  const last = values[values.length - 1] ?? Date.now();
  return () => queue.shift() ?? last;
}

function makeOmni(overrides?: Partial<any>): any {
  return {
    colony: {
      publish: vi.fn().mockResolvedValue({
        ok: true,
        data: { txHash: "0xpublish" },
        provenance: { path: "local", latencyMs: 15 },
      }),
      reply: vi.fn().mockResolvedValue({
        ok: true,
        data: { txHash: "0xreply" },
        provenance: { path: "local", latencyMs: 15 },
      }),
      getFeed: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          posts: [],
          meta: { lastBlock: 123 },
        },
      }),
      getPostDetail: vi.fn().mockResolvedValue({
        ok: false,
        error: "not_found",
      }),
      ...overrides?.colony,
    },
    runtime: {
      sdkBridge: {},
      ...overrides?.runtime,
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("minimal agent runtime", () => {
  it("writes skip cycle artifacts and persists next state", async () => {
    const stateDir = await createTempDir();
    const record = await runMinimalAgentCycle(
      async () => ({
        kind: "skip",
        reason: "no_new_signal",
        facts: { signalCount: 0 },
        nextState: { lastReason: "no_new_signal" },
      }),
      {
        omni: makeOmni(),
        stateDir,
        cycleId: "cycle-skip",
        now: makeNow(1_700_000_000_000, 1_700_000_000_250),
      },
    );

    expect(record.outcome.status).toBe("skipped");
    expect(record.memoryAfter.state).toEqual({ lastReason: "no_new_signal" });

    const latest = await readJson(resolve(stateDir, "runs", "latest.json"));
    const state = await readJson(resolve(stateDir, "state", "current.json"));
    const summary = await readFile(resolve(stateDir, "runs", "2023-11-14", "cycle-skip.md"), "utf-8");

    expect(latest.outcome.status).toBe("skipped");
    expect(state.agentState).toEqual({ lastReason: "no_new_signal" });
    expect(state.lastCycle.status).toBe("skipped");
    expect(summary).toContain("SkipReason: no_new_signal");
  });

  it("publishes, verifies visibility, and records tx metadata", async () => {
    const stateDir = await createTempDir();
    const omni = makeOmni({
      colony: {
        publish: vi.fn().mockResolvedValue({
          ok: true,
          data: { txHash: "0xabc" },
          provenance: { path: "local", latencyMs: 20 },
        }),
        getFeed: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            posts: [
              {
                txHash: "0xabc",
                payload: {
                  cat: "ANALYSIS",
                  text: "Coverage gap is narrowing.",
                },
                blockNumber: 321,
              },
            ],
            meta: { lastBlock: 321 },
          },
        }),
      },
    });

    const record = await runMinimalAgentCycle(
      async () => ({
        kind: "publish",
        category: "ANALYSIS",
        text: "Coverage gap is narrowing.",
        attestUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        tags: ["coverage"],
        confidence: 88,
        attestationPlan: {
          topic: "coverage-gap",
          agent: "sentinel",
          catalogPath: "/tmp/catalog.json",
          ready: true,
          reason: "ready",
          primary: {
            sourceId: "coingecko-price",
            name: "CoinGecko Simple Price",
            provider: "coingecko",
            status: "active",
            trustTier: "official",
            responseFormat: "json",
            ratingOverall: 88,
            dahrSafe: true,
            tlsnSafe: false,
            url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            score: 17,
          },
          supporting: [],
          fallbacks: [],
          warnings: [],
        },
        audit: {
          inputs: {
            signals: [{ topic: "coverage-gap", confidence: 88 }],
          },
          selectedEvidence: {
            matchedSignal: { topic: "coverage-gap" },
          },
          promptPacket: {
            objective: "Write a post about the selected coverage gap.",
          },
        },
        nextState: { lastTopic: "coverage-gap" },
      }),
      {
        omni,
        stateDir,
        cycleId: "cycle-publish",
        now: makeNow(1_700_000_001_000, 1_700_000_001_500),
      },
    );

    expect(omni.colony.publish).toHaveBeenCalledWith({
      text: "Coverage gap is narrowing.",
      category: "ANALYSIS",
      attestUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      tags: ["coverage"],
      confidence: 88,
    });
    expect(record.outcome.status).toBe("published");
    expect(record.outcome.txHash).toBe("0xabc");
    expect(record.outcome.verification?.indexedVisible).toBe(true);
    expect(record.outcome.verification?.verificationPath).toBe("feed");
    expect(record.memoryAfter.state).toEqual({ lastTopic: "coverage-gap" });

    const latest = await readJson(resolve(stateDir, "runs", "latest.json"));
    const summary = await readFile(resolve(stateDir, "runs", "2023-11-14", "cycle-publish.md"), "utf-8");
    expect(latest.decision.audit.inputs.signals[0].topic).toBe("coverage-gap");
    expect(summary).toContain("AuditSections: inputs, selectedEvidence, promptPacket");
    expect(summary).toContain("AttestationPlan: ready (ready)");
  });

  it("supports dry-run publishes without spending or calling publish()", async () => {
    const stateDir = await createTempDir();
    const omni = makeOmni();

    const record = await runMinimalAgentCycle(
      async () => ({
        kind: "publish",
        category: "OBSERVATION",
        text: "Dry-run only.",
        attestUrl: "https://example.com/dry-run",
      }),
      {
        omni,
        stateDir,
        dryRun: true,
        cycleId: "cycle-dry-run",
        now: makeNow(1_700_000_002_000, 1_700_000_002_300),
      },
    );

    expect(omni.colony.publish).not.toHaveBeenCalled();
    expect(record.outcome.status).toBe("dry_run");
    expect(record.outcome.demSpendEstimate).toBe(0);
  });

  it("blocks live publishes that still use placeholder attestation URLs", async () => {
    const stateDir = await createTempDir();
    const omni = makeOmni();

    const record = await runMinimalAgentCycle(
      async () => ({
        kind: "publish",
        category: "ANALYSIS",
        text: "Placeholder publish should be blocked.",
        attestUrl: "https://example.com/report",
      }),
      {
        omni,
        stateDir,
        cycleId: "cycle-placeholder-block",
        now: makeNow(1_700_000_002_500, 1_700_000_002_800),
      },
    );

    expect(omni.colony.publish).not.toHaveBeenCalled();
    expect(record.outcome.status).toBe("failed");
    expect(record.outcome.error?.message).toContain("placeholder_attest_url");
  });

  it("reuses one omni session across loop iterations and advances persisted iteration", async () => {
    const stateDir = await createTempDir();
    const omni = makeOmni();
    const observe = vi.fn().mockResolvedValue({
      kind: "skip",
      reason: "steady_state",
      nextState: { stable: true },
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runMinimalAgentLoop(observe, {
      omni,
      stateDir,
      maxIterations: 2,
      intervalMs: 25,
      sleep,
      now: makeNow(
        1_700_000_003_000,
        1_700_000_003_100,
        1_700_000_004_000,
        1_700_000_004_100,
      ),
    });

    expect(observe).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const state = await readJson(resolve(stateDir, "state", "current.json"));
    expect(state.iteration).toBe(2);
    expect(state.agentState).toEqual({ stable: true });
  });

  it("defaults state output under the current working directory", () => {
    expect(getDefaultMinimalStateDir("/tmp/demo")).toBe(resolve("/tmp/demo", ".omniweb-agent"));
  });
});
