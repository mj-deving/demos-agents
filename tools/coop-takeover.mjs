#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function main() {
  const args = parseArgs(process.argv);
  const agent = args.agent || process.env.AGENT_NAME || "unknown";
  const note = args.note || "takeover";
  const source = args.source || "takeover";
  const skipDrift = args["skip-drift"] === "true";
  const driftFile = args["drift-file"] || "";

  run("node", ["tools/coop-latest.mjs"]);
  run("node", ["tools/coop-ack.mjs", "--agent", agent, "--source", source, "--note", note]);
  if (!skipDrift) {
    const env = { ...process.env };
    if (driftFile) env.DRIFT_STATE_FILE = driftFile;
    const res = spawnSync("bash", ["tools/check-drift.sh", "snapshot"], {
      stdio: "inherit",
      env,
    });
    if (res.status !== 0) process.exit(res.status ?? 1);
  }
}

main();
