#!/usr/bin/env npx tsx
/**
 * probe-remaining-surfaces.ts — maintained live proof path for the remaining
 * production-host gaps: price history, registration/linking, dev-only mirrors,
 * and TLSN.
 *
 * Default behavior is mostly read-only: it probes getPriceHistory(), linked-agent
 * reads, dev-only mirrors, and a bounded TLSN subprocess. Passing `--execute`
 * also performs the live register + link + unlink round trip against the current
 * authenticated wallet so the identity path can be proven and cleaned up in one run.
 *
 * Output: JSON to stdout. Errors to stderr.
 * Exit codes: 0 = all targeted surfaces are currently green or explicitly bounded,
 *             1 = at least one target surface remains degraded,
 *             2 = invalid args.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getNumberArg, getStringArg, hasFlag, loadConnect } from "./_shared.js";

const DEFAULT_PRICE_ASSET = "BTC";
const DEFAULT_PRICE_PERIODS = 24;
const DEFAULT_TLSN_URL = "https://blockchain.info/ticker";
const DEFAULT_TLSN_TIMEOUT_MS = 180_000;
const DEFAULT_REGISTER_NAME = "mj-codex-proof-agent";
const DEFAULT_REGISTER_DESCRIPTION = "Production-host proof agent for omniweb-toolkit live surface verification.";
const DEFAULT_REGISTER_SPECIALTIES = ["testing", "proof"];
const DEV_ONLY_FIXTURE_ID = "dev-proof-probe";

type OmniInstance = Awaited<ReturnType<Awaited<ReturnType<typeof loadConnect>>>>;

type ApiLikeResult = null | undefined | {
  ok?: boolean;
  status?: number;
  error?: unknown;
  data?: unknown;
};

const args = process.argv.slice(2);

if (hasFlag(args, "--tlsn-child")) {
  await runTlsnChild();
}

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-remaining-surfaces.ts [options]

Options:
  --price-asset TICKER       Asset for getPriceHistory() (default: ${DEFAULT_PRICE_ASSET})
  --price-periods N          History window for getPriceHistory() (default: ${DEFAULT_PRICE_PERIODS})
  --tlsn-url URL             URL for attestTlsn() (default: ${DEFAULT_TLSN_URL})
  --tlsn-timeout-ms N        Timeout for the bounded TLSN subprocess (default: ${DEFAULT_TLSN_TIMEOUT_MS})
  --register-name NAME       Agent name for the live register() proof
  --register-description TXT Agent description for the live register() proof
  --register-specialties CSV Agent specialties for the live register() proof
  --state-dir PATH           Override state directory for runtime guards
  --execute                  Perform the live register + link + unlink proof
  --skip-tlsn                Skip the bounded TLSN probe
  --help, -h                 Show this help

Output: JSON remaining-surface proof report
Exit codes: 0 = all targeted surfaces are green or explicitly bounded, 1 = degraded, 2 = invalid args`);
  process.exit(0);
}

for (const flag of [
  "--price-asset",
  "--price-periods",
  "--tlsn-url",
  "--tlsn-timeout-ms",
  "--register-name",
  "--register-description",
  "--register-specialties",
  "--state-dir",
]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const priceAsset = (getStringArg(args, "--price-asset") ?? DEFAULT_PRICE_ASSET).trim().toUpperCase();
const pricePeriods = getPositiveIntegerArg("--price-periods", DEFAULT_PRICE_PERIODS);
const tlsnUrl = getStringArg(args, "--tlsn-url") ?? DEFAULT_TLSN_URL;
const tlsnTimeoutMs = getPositiveIntegerArg("--tlsn-timeout-ms", DEFAULT_TLSN_TIMEOUT_MS);
const registerName = getStringArg(args, "--register-name") ?? DEFAULT_REGISTER_NAME;
const registerDescription = getStringArg(args, "--register-description") ?? DEFAULT_REGISTER_DESCRIPTION;
const registerSpecialties = ((getStringArg(args, "--register-specialties") ?? DEFAULT_REGISTER_SPECIALTIES.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const stateDir = getStringArg(args, "--state-dir") || undefined;
const execute = hasFlag(args, "--execute");
const skipTlsn = hasFlag(args, "--skip-tlsn");

if (!priceAsset) {
  console.error("Error: --price-asset must not be empty");
  process.exit(2);
}

if (registerSpecialties.length === 0) {
  console.error("Error: --register-specialties must contain at least one specialty");
  process.exit(2);
}

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir });

  const [priceHistory, linkedBefore, devOnlyMirrors] = await Promise.all([
    omni.colony.getPriceHistory(priceAsset, pricePeriods),
    omni.colony.getLinkedAgents(),
    probeDevOnlyMirrors(omni),
  ]);

  const execution = execute
    ? await runRegisterAndLinkProof(omni, {
        name: registerName,
        description: registerDescription,
        specialties: registerSpecialties,
      })
    : {
        attempted: false,
        message: "Dry run only. Re-run with --execute to perform the live register + link + unlink proof.",
      };

  const tlsn = skipTlsn
    ? {
        attempted: false,
        skipped: true,
      }
    : runTlsnSubprocess({
        stateDir,
        tlsnUrl,
        timeoutMs: tlsnTimeoutMs,
      });

  const priceHistoryOk = !!priceHistory?.ok;
  const linkedReadOk = !!linkedBefore?.ok;
  const executionOk = !execute || !!execution.ok;
  const tlsnOk = !!tlsn.ok;
  const devOnlyMirrorsBounded = Object.values(devOnlyMirrors).every((entry) => entry.bounded);
  const overallOk = priceHistoryOk && linkedReadOk && executionOk && tlsnOk && devOnlyMirrorsBounded;

  console.log(JSON.stringify({
    attempted: true,
    ok: overallOk,
    address: omni.address,
    priceHistory: summarizeApiResult(priceHistory, {
      success: priceHistoryOk ? "history returned" : "still empty on production host",
      bounded: !priceHistoryOk,
    }),
    linkedAgentsRead: summarizeApiResult(linkedBefore, {
      success: "linked-agent read succeeded",
      bounded: false,
    }),
    registerAndLink: execution,
    devOnlyMirrors,
    tlsn,
  }, null, 2));

  process.exit(overallOk ? 0 : 1);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function probeDevOnlyMirrors(omni: OmniInstance): Promise<Record<string, {
  ok: boolean;
  status: number | null;
  detail: string;
  bounded: boolean;
}>> {
  const address = omni.address;
  const checks: Record<string, () => Promise<ApiLikeResult>> = {
    getEthPool: () => omni.colony.getEthPool("ETH", "24h"),
    getEthWinners: () => omni.colony.getEthWinners("ETH"),
    getEthHigherLowerPool: () => omni.colony.getEthHigherLowerPool("BTC", "24h"),
    getEthBinaryPools: () => omni.colony.getEthBinaryPools(),
    getSportsMarkets: () => omni.colony.getSportsMarkets({ status: "open" }),
    getSportsPool: () => omni.colony.getSportsPool(DEV_ONLY_FIXTURE_ID),
    getSportsWinners: () => omni.colony.getSportsWinners(DEV_ONLY_FIXTURE_ID),
    getCommodityPool: () => omni.colony.getCommodityPool("GOLD", "24h"),
    getPredictionIntelligence: () => omni.colony.getPredictionIntelligence({ limit: 1 }),
    getPredictionRecommendations: () => omni.colony.getPredictionRecommendations(address),
  };

  const output: Record<string, { ok: boolean; status: number | null; detail: string; bounded: boolean }> = {};
  for (const [name, run] of Object.entries(checks)) {
    const result = await run();
    const status = typeof result?.status === "number" ? result.status : null;
    const error = typeof result?.error === "string" ? result.error : "";
    const bounded = !result?.ok && status === 404;
    output[name] = {
      ok: !!result?.ok,
      status,
      detail: bounded
        ? "hard 404 on production host"
        : result?.ok
          ? "available on production host"
          : error.slice(0, 160) || "unknown error",
      bounded,
    };
  }

  return output;
}

async function runRegisterAndLinkProof(
  omni: OmniInstance,
  registerOpts: { name: string; description: string; specialties: string[] },
): Promise<Record<string, unknown>> {
  const agentAddress = omni.address;
  const register = await omni.colony.register(registerOpts);
  const challenge = await omni.colony.createAgentLinkChallenge(agentAddress);

  const challengeValue = challenge?.ok
    ? challenge.data.challenge ?? challenge.data.nonce ?? challenge.data.challengeId
    : undefined;
  const sign = challenge?.ok
    ? await omni.chain.signMessage(challenge.data.message)
    : { ok: false, error: "challenge failed" };
  const signature = sign.ok && sign.signature && typeof sign.signature === "object"
    ? ((sign.signature as Record<string, unknown>).data ?? sign.signature)
    : undefined;

  const claim = challenge?.ok && typeof challengeValue === "string" && typeof signature === "string"
    ? await omni.colony.claimAgentLink({
        challenge: challengeValue,
        agentAddress,
        signature,
      })
    : null;
  const approve = claim?.ok && typeof challengeValue === "string"
    ? await omni.colony.approveAgentLink({
        challenge: challengeValue,
        agentAddress,
        action: "approve",
      })
    : null;
  const linked = await omni.colony.getLinkedAgents();
  const unlink = approve?.ok
    ? await omni.colony.unlinkAgent(agentAddress)
    : null;
  const linkedAfter = await omni.colony.getLinkedAgents();

  const ok = !!register?.ok && !!challenge?.ok && !!sign.ok && !!claim?.ok && !!approve?.ok && !!linked?.ok && !!unlink?.ok && !!linkedAfter?.ok;

  return {
    attempted: true,
    ok,
    register: summarizeApiResult(register, { success: "register() succeeded", bounded: false }),
    challenge: challenge?.ok
      ? {
          ok: true,
          challenge: challengeValue ?? null,
          humanAddress: challenge.data.humanAddress ?? null,
          expiresAt: challenge.data.expiresAt ?? null,
        }
      : summarizeApiResult(challenge, { success: "challenge created", bounded: false }),
    sign,
    claim: summarizeApiResult(claim, { success: "claimAgentLink() accepted live challenge nonce", bounded: false }),
    approve: summarizeApiResult(approve, { success: "approveAgentLink() accepted live challenge nonce plus agentAddress", bounded: false }),
    linked: summarizeApiResult(linked, { success: "linked-agent list showed the linked agent", bounded: false }),
    unlink: summarizeApiResult(unlink, { success: "unlinkAgent() cleaned up the live link", bounded: false }),
    linkedAfter: summarizeApiResult(linkedAfter, { success: "linked-agent list returned after cleanup", bounded: false }),
  };
}

function runTlsnSubprocess(options: {
  stateDir?: string;
  tlsnUrl: string;
  timeoutMs: number;
}): Record<string, unknown> {
  const scriptPath = fileURLToPath(import.meta.url);
  const childArgs = [
    "--import",
    "tsx",
    scriptPath,
    "--tlsn-child",
    "--tlsn-url",
    options.tlsnUrl,
  ];

  if (options.stateDir) {
    childArgs.push("--state-dir", options.stateDir);
  }

  const child = spawnSync(process.execPath, childArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: options.timeoutMs,
    env: process.env,
  });

  if (child.error && child.error.message.includes("ETIMEDOUT")) {
    return {
      attempted: true,
      ok: false,
      timeoutMs: options.timeoutMs,
      error: `TLSN child timed out after ${options.timeoutMs}ms`,
    };
  }

  const output = (child.stdout ?? "").trim();
  if (!output) {
    return {
      attempted: true,
      ok: false,
      timeoutMs: options.timeoutMs,
      error: child.stderr.trim() || `TLSN child exited with status ${child.status ?? 1}`,
    };
  }

  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return {
      attempted: true,
      timeoutMs: options.timeoutMs,
      ...parsed,
    };
  } catch {
    return {
      attempted: true,
      ok: false,
      timeoutMs: options.timeoutMs,
      error: "TLSN child returned non-JSON output",
      stdout: output,
      stderr: child.stderr.trim(),
    };
  }
}

function summarizeApiResult(
  result: ApiLikeResult,
  options: { success: string; bounded: boolean },
): Record<string, unknown> {
  if (result?.ok) {
    return {
      ok: true,
      status: typeof result.status === "number" ? result.status : null,
      detail: options.success,
      data: result.data ?? null,
      bounded: options.bounded,
    };
  }

  return {
    ok: false,
    status: typeof result?.status === "number" ? result.status : null,
    detail: typeof result?.error === "string" ? result.error.slice(0, 200) : "unknown error",
    bounded: options.bounded,
  };
}

function getPositiveIntegerArg(flag: string, fallback: number): number {
  const parsed = getNumberArg(args, flag) ?? fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

async function runTlsnChild(): Promise<never> {
  const stateDir = getStringArg(args, "--state-dir") || undefined;
  const tlsnUrl = getStringArg(args, "--tlsn-url") ?? DEFAULT_TLSN_URL;
  const connect = await loadConnect();
  const omni = await connect({ stateDir });
  const startedAt = Date.now();
  const result = await omni.colony.attestTlsn(tlsnUrl);
  console.log(JSON.stringify({
    ok: !!result.ok,
    elapsedMs: Date.now() - startedAt,
    result,
  }));
  process.exit(result.ok ? 0 : 1);
}
