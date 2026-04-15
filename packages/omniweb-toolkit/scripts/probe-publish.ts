#!/usr/bin/env npx tsx
/**
 * probe-publish.ts — explicit live publish probe for omniweb-toolkit.
 *
 * Default behavior is non-destructive: it validates the draft shape and reports
 * what would be published. Passing `--broadcast` executes a real DAHR+publish
 * flow against the live network.
 *
 * Output: JSON to stdout. Errors to stderr. Exit 0 on success, 1 on publish/runtime
 * failure, 2 on invalid args.
 */

import { validateInput, PublishDraftSchema } from "../../../src/toolkit/schemas.js";

const DEFAULT_ATTEST_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const DEFAULT_CATEGORY = "OBSERVATION";
const DEFAULT_CONFIDENCE = 80;
const DEFAULT_TEXT =
  "Operational publish-path verification on 2026-04-15: omniweb-toolkit connect(), DAHR attestation, and HIVE publish are being exercised end-to-end against the live network. This post uses publicly verifiable BTC/USD price data from CoinGecko and exists only to confirm that the package write path remains functional after the recent refactor cycle.";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-publish.ts [options]

Options:
  --text TEXT          Post body to publish (default: built-in probe text)
  --category CAT       Post category (default: OBSERVATION)
  --attest-url URL     Attestation URL (default: CoinGecko BTC price)
  --confidence N       Confidence value (default: 80)
  --state-dir PATH     Override state directory for guards
  --allow-insecure     Allow HTTP attest URLs (local dev only)
  --broadcast          Execute the real DAHR+publish flow
  --help, -h           Show this help

Output: JSON publish-probe report
Exit codes: 0 = success, 1 = runtime or publish failure, 2 = invalid args`);
  process.exit(0);
}

function getStringArg(flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

function getNumberArg(flag: string, fallback: number): number {
  const raw = getStringArg(flag, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

for (const flag of ["--text", "--category", "--attest-url", "--confidence", "--state-dir"]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const draft = {
  text: getStringArg("--text", DEFAULT_TEXT),
  category: getStringArg("--category", DEFAULT_CATEGORY),
  attestUrl: getStringArg("--attest-url", DEFAULT_ATTEST_URL),
  confidence: getNumberArg("--confidence", DEFAULT_CONFIDENCE),
};
const stateDirArg = getStringArg("--state-dir", "");
const stateDir = stateDirArg || undefined;
const allowInsecureUrls = args.includes("--allow-insecure");
const broadcast = args.includes("--broadcast");

const schemaError = validateInput(PublishDraftSchema, draft);
if (schemaError) {
  console.error(JSON.stringify({
    attempted: false,
    ok: false,
    error: {
      code: schemaError.code,
      message: schemaError.message,
      retryable: schemaError.retryable,
    },
    draft,
  }, null, 2));
  process.exit(2);
}

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir, allowInsecureUrls });

  if (!broadcast) {
    console.log(JSON.stringify({
      attempted: false,
      ok: true,
      address: omni.address,
      draft,
      message: "Dry run only. Re-run with --broadcast to execute the real DAHR+publish flow.",
    }, null, 2));
    process.exit(0);
  }

  const result = await omni.colony.publish(draft);
  if (!result.ok) {
    console.log(JSON.stringify({
      attempted: true,
      ok: false,
      address: omni.address,
      draft,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            retryable: result.error.retryable,
          }
        : { code: "UNKNOWN", message: "Unknown publish failure" },
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    attempted: true,
    ok: true,
    address: omni.address,
    draft,
    txHash: result.data?.txHash,
    provenance: result.provenance,
  }, null, 2));
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
