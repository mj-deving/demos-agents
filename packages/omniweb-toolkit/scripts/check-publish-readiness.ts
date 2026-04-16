#!/usr/bin/env npx tsx
/**
 * check-publish-readiness.ts — non-destructive publish preflight for omniweb-toolkit.
 *
 * Uses the real connect() runtime plus internal guard checks to answer:
 * - can we connect and authenticate?
 * - does the draft pass local validation?
 * - is the attestation URL allowed and SSRF-safe?
 * - do local publish guards currently permit a write?
 *
 * Optional: `--probe-attest` performs a real standalone DAHR attestation, which
 * spends DEM and writes on-chain. It is disabled by default for safety.
 *
 * Output: JSON report to stdout. Errors to stderr. Exit 0 on successful probe,
 * 1 on runtime error, 2 on invalid args.
 */

import { validateInput, PublishDraftSchema } from "../../../src/toolkit/schemas.js";
import { validateUrl } from "../../../src/toolkit/url-validator.js";
import { checkAndRecordDedup } from "../../../src/toolkit/guards/dedup-guard.js";
import { getWriteRateRemaining } from "../../../src/toolkit/guards/write-rate-limit.js";
import { createSessionFromRuntime } from "../src/session-factory.js";

const DEFAULT_ATTEST_URL = "https://blockchain.info/ticker";
const DEFAULT_TEXT =
  "Bitcoin spot pricing remains one of the cleanest low-risk publish probes when the attestation target is stable, public, and easy to verify independently. This draft exists only to validate readiness and should not be broadcast unless the operator explicitly chooses to move past preflight.";
const DEFAULT_CATEGORY = "ANALYSIS";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/check-publish-readiness.ts [options]

Options:
  --attest-url URL     Attestation URL to validate (default: Blockchain.info ticker JSON)
  --text TEXT          Draft text to check against publish guards
  --category CAT       Draft category (default: ANALYSIS)
  --state-dir PATH     Override state directory for guard persistence
  --probe-attest       Run a real standalone DAHR attestation probe (spends DEM)
  --allow-insecure     Allow HTTP attest URLs (local dev only)
  --help, -h           Show this help

Output: JSON publish-readiness report
Exit codes: 0 = success, 1 = runtime error, 2 = invalid args`);
  process.exit(0);
}

function getStringArg(flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

const attestUrl = getStringArg("--attest-url", DEFAULT_ATTEST_URL);
const text = getStringArg("--text", DEFAULT_TEXT);
const category = getStringArg("--category", DEFAULT_CATEGORY);
const stateDirArg = getStringArg("--state-dir", "");
const allowInsecureUrls = args.includes("--allow-insecure");
const probeAttest = args.includes("--probe-attest");

for (const flag of ["--attest-url", "--text", "--category", "--state-dir"]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const stateDir = stateDirArg || undefined;

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir, allowInsecureUrls });
  const session = await createSessionFromRuntime(omni.runtime, { stateDir, allowInsecureUrls });
  const authToken = await omni.runtime.getToken();

  const balanceResult = await omni.colony.getBalance();
  const feedResult = await omni.colony.getFeed({ limit: 3 });
  const schemaError = validateInput(PublishDraftSchema, {
    text,
    category,
    attestUrl,
  });
  const urlCheck = await validateUrl(attestUrl, { allowInsecure: allowInsecureUrls });
  const writeRate = await getWriteRateRemaining(session.stateStore, session.walletAddress);
  const dedupError = await checkAndRecordDedup(session.stateStore, session.walletAddress, text, false);

  let attestProbe:
    | {
        attempted: true;
        ok: boolean;
        txHash?: string;
        responseHash?: string;
        error?: { code: string; message: string; retryable?: boolean };
      }
    | { attempted: false }
    = { attempted: false };

  if (probeAttest) {
    const probeResult = await omni.colony.attest({ url: attestUrl });
    attestProbe = probeResult.ok
      ? {
          attempted: true,
          ok: true,
          txHash: probeResult.data?.txHash,
          responseHash: probeResult.data?.responseHash,
        }
      : {
          attempted: true,
          ok: false,
          error: probeResult.error
            ? {
                code: probeResult.error.code,
                message: probeResult.error.message,
                retryable: probeResult.error.retryable,
              }
            : { code: "UNKNOWN", message: "Unknown attestation failure" },
        };
  }

  const balanceData = balanceResult.ok
    ? balanceResult.data as { balance?: number; available?: number }
    : null;
  const balance = Number(balanceData?.balance ?? balanceData?.available ?? 0);

  const blockers: string[] = [];
  if (!authToken) blockers.push("token_unavailable");
  if (!balanceResult.ok) blockers.push("balance_unavailable");
  if (balanceResult.ok && balance <= 0) blockers.push("insufficient_dem");
  if (!feedResult.ok) blockers.push("feed_unavailable");
  if (schemaError) blockers.push("draft_invalid");
  if (!urlCheck.valid) blockers.push("attest_url_blocked");
  if (writeRate.hourlyRemaining <= 0) blockers.push("hourly_limit_reached");
  if (writeRate.dailyRemaining <= 0) blockers.push("daily_limit_reached");
  if (dedupError) blockers.push("duplicate_text");
  if (attestProbe.attempted && !attestProbe.ok) blockers.push("attest_probe_failed");

  console.log(
    JSON.stringify(
      {
        ok: blockers.length === 0,
        address: omni.address,
        stateDir: stateDir ?? "(default)",
        auth: {
          tokenAvailable: !!authToken,
          sdkBridgeApiAccess: omni.runtime.sdkBridge.apiAccess,
        },
        draft: {
          category,
          textLength: text.length,
          attestUrl,
        },
        checks: {
          connect: true,
          tokenAvailable: !!authToken,
          balance: {
            ok: balanceResult.ok,
            dem: balance,
            error: balanceResult.ok ? undefined : balanceResult.error,
          },
          feedRead: {
            ok: feedResult.ok,
            count: feedResult.ok
              ? Array.isArray((feedResult.data as { posts?: unknown[] })?.posts)
                ? (feedResult.data as { posts: unknown[] }).posts.length
                : 0
              : 0,
            error: feedResult.ok ? undefined : feedResult.error,
          },
          draftSchema: schemaError
            ? { ok: false, code: schemaError.code, message: schemaError.message }
            : { ok: true },
          urlValidation: urlCheck.valid
            ? { ok: true }
            : { ok: false, reason: urlCheck.reason ?? "unknown" },
          writeRate,
          dedup: dedupError
            ? { ok: false, code: dedupError.code, message: dedupError.message }
            : { ok: true },
          attestProbe,
        },
        blockers,
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function loadConnect(): Promise<(opts?: {
  stateDir?: string;
  allowInsecureUrls?: boolean;
}) => Promise<any>> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect;
}
