#!/usr/bin/env npx tsx
/**
 * probe-storage.ts — explicit live StorageProgram write probe for omniweb-toolkit.
 *
 * Default behavior is non-destructive: it prints the derived storage address,
 * initial payload previews, and estimated fees. Passing `--broadcast` executes
 * a real CREATE_STORAGE_PROGRAM followed by SET_FIELD against the live network.
 *
 * Output: JSON to stdout. Errors to stderr. Exit 0 on success, 1 on runtime or
 * transaction failure, 2 on invalid args.
 */

import { DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { StorageProgram } from "@kynesyslabs/demosdk/storage";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-storage.ts [options]

Options:
  --program-name NAME   Storage program name (default: unique omniweb probe name)
  --state-dir PATH      Override state directory
  --broadcast           Execute the real CREATE + SET_FIELD probe
  --help, -h            Show this help

Output: JSON storage probe report
Exit codes: 0 = success, 1 = runtime or transaction failure, 2 = invalid args`);
  process.exit(0);
}

function getStringArg(flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

for (const flag of ["--program-name", "--state-dir"]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const programName = getStringArg("--program-name", `omniweb-probe-${Date.now()}`);
const stateDirArg = getStringArg("--state-dir", "");
const stateDir = stateDirArg || undefined;
const broadcast = args.includes("--broadcast");

const initialData = {
  marker: "omniweb-storage-probe",
  createdAt: new Date().toISOString(),
  version: 1,
};

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir });
  const address = omni.address;
  const nonce = 1;
  const storageAddress = StorageProgram.deriveStorageAddress(address, programName, nonce);
  const createPayload = StorageProgram.createStorageProgram(
    address,
    programName,
    initialData,
    "json",
    StorageProgram.publicACL(),
    { nonce },
  );
  const setFieldValue = new Date().toISOString();
  const setPayload = StorageProgram.setField(storageAddress, "lastProbe", setFieldValue);

  if (!broadcast) {
    console.log(JSON.stringify({
      attempted: false,
      ok: true,
      address,
      programName,
      storageAddress,
      estimatedCreateFeeDem: StorageProgram.calculateStorageFee(initialData, "json").toString(),
      createPayload,
      setPayload,
      message: "Dry run only. Re-run with --broadcast to execute the real StorageProgram CREATE + SET_FIELD probe.",
    }, null, 2));
    process.exit(0);
  }

  const createTx = await submitStorageTransaction(omni.runtime.demos, address, storageAddress, createPayload);
  await sleep(5000);
  const readAfterCreate = await StorageProgram.getByAddress("https://demosnode.discus.sh", storageAddress, address);

  const setTx = await submitStorageTransaction(omni.runtime.demos, address, storageAddress, setPayload);
  await sleep(3000);
  const fieldAfterSet = await StorageProgram.getValue("https://demosnode.discus.sh", storageAddress, "lastProbe", address);

  console.log(JSON.stringify({
    attempted: true,
    ok: true,
    address,
    programName,
    storageAddress,
    create: createTx,
    readAfterCreate,
    setField: setTx,
    fieldAfterSet,
  }, null, 2));
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function submitStorageTransaction(
  demos: any,
  address: string,
  storageAddress: string,
  payload: unknown,
) {
  const tx = DemosTransactions.empty();
  tx.content = {
    ...tx.content,
    type: "storageProgram",
    from: address,
    to: storageAddress,
    data: ["storageProgram", payload as any],
    amount: 0,
    timestamp: Date.now(),
  };

  const signed = await demos.sign(tx);
  const validity = await demos.confirm(signed);
  const broadcast = await demos.broadcast(validity);

  return {
    txHash: validity?.response?.data?.transaction?.hash ?? null,
    confirmationBlock: broadcast?.extra?.confirmationBlock ?? null,
    broadcastMessage: broadcast?.response?.message ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
