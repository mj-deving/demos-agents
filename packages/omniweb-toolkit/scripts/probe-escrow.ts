#!/usr/bin/env npx tsx
/**
 * probe-escrow.ts — explicit live escrow send probe for omniweb-toolkit.
 *
 * Default behavior is non-destructive: it reports the intended target and amount.
 * Passing `--broadcast` executes a real `sendToIdentity()` escrow transfer.
 *
 * Output: JSON to stdout. Errors to stderr. Exit 0 on success, 1 on runtime or
 * escrow failure, 2 on invalid args.
 */

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-escrow.ts [options]

Options:
  --platform NAME      Platform: github | twitter | telegram
  --username NAME      Username on that platform
  --amount N           DEM amount to escrow (default: 0.1)
  --message TEXT       Optional escrow message
  --state-dir PATH     Override state directory
  --broadcast          Execute the real escrow send
  --help, -h           Show this help

Output: JSON escrow probe report
Exit codes: 0 = success, 1 = runtime or escrow failure, 2 = invalid args`);
  process.exit(0);
}

function getStringArg(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function getNumberArg(flag: string, fallback: number): number {
  const raw = getStringArg(flag);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

for (const flag of ["--platform", "--username", "--amount", "--message", "--state-dir"]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const platform = getStringArg("--platform");
const username = getStringArg("--username");
const amount = getNumberArg("--amount", 0.1);
const message = getStringArg("--message");
const stateDirArg = getStringArg("--state-dir");
const stateDir = stateDirArg || undefined;
const broadcast = args.includes("--broadcast");

if (!platform || !username) {
  console.error("Error: --platform and --username are required");
  process.exit(2);
}

if (!["github", "twitter", "telegram"].includes(platform)) {
  console.error(`Error: unsupported platform ${platform}`);
  process.exit(2);
}

if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Error: invalid amount ${amount}`);
  process.exit(2);
}

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir });

  if (!broadcast) {
    console.log(JSON.stringify({
      attempted: false,
      ok: true,
      address: omni.address,
      platform,
      username,
      amount,
      message,
      note: "Dry run only. Re-run with --broadcast to execute the real escrow send.",
    }, null, 2));
    process.exit(0);
  }

  const result = await omni.escrow.sendToIdentity(platform as "github" | "twitter" | "telegram", username, amount, {
    message,
  });

  if (!result.ok) {
    console.log(JSON.stringify({
      attempted: true,
      ok: false,
      address: omni.address,
      platform,
      username,
      amount,
      message,
      result,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    attempted: true,
    ok: true,
    address: omni.address,
    platform,
    username,
    amount,
    message,
    txHash: result.txHash,
  }, null, 2));
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function loadConnect(): Promise<(opts?: {
  stateDir?: string;
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
