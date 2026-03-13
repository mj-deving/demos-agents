#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const STATUS_FILE = path.join(root, "claude-codex-coop", "STATUS.md");
const HANDOFF_FILE = path.join(root, "claude-codex-coop", "logs", "SESSION-HANDOFFS.md");
const DEFAULT_TAIL_BYTES = 128 * 1024; // 128 KiB

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

function readStatus() {
  if (!fs.existsSync(STATUS_FILE)) return null;
  return fs.readFileSync(STATUS_FILE, "utf8").trim();
}

function findLatestHeadingIndex(text) {
  if (!text) return -1;
  const idx = text.lastIndexOf("\n## ");
  if (idx >= 0) return idx + 1;
  return text.startsWith("## ") ? 0 : -1;
}

function readLatestHandoff(tailBytes) {
  if (!fs.existsSync(HANDOFF_FILE)) return null;

  const stat = fs.statSync(HANDOFF_FILE);
  const size = stat.size;
  if (size === 0) return null;

  const bytes = Number.isFinite(tailBytes) && tailBytes > 0 ? Math.floor(tailBytes) : DEFAULT_TAIL_BYTES;
  const start = Math.max(0, size - bytes);
  const length = size - start;

  const fd = fs.openSync(HANDOFF_FILE, "r");
  let tailText = "";
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    tailText = buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }

  let idx = findLatestHeadingIndex(tailText);
  if (idx >= 0) {
    return tailText.slice(idx).trim();
  }

  // Heading might be outside tail window; fallback to full file read.
  const full = fs.readFileSync(HANDOFF_FILE, "utf8");
  idx = findLatestHeadingIndex(full);
  if (idx < 0) return null;
  return full.slice(idx).trim();
}

function main() {
  const args = parseArgs(process.argv);
  const tailBytes = args["tail-bytes"] ? Number(args["tail-bytes"]) : DEFAULT_TAIL_BYTES;
  const json = args.json === "true";

  const status = readStatus();
  const latestHandoff = readLatestHandoff(tailBytes);

  if (json) {
    console.log(JSON.stringify({ status, latestHandoff }, null, 2));
    return;
  }

  console.log("=== STATUS ===");
  console.log(status || "(missing)");
  console.log("");
  console.log("=== LATEST HANDOFF ===");
  console.log(latestHandoff || "(missing)");
}

main();
