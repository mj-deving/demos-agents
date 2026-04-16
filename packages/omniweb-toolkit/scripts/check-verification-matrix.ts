#!/usr/bin/env npx tsx

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "./_shared.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx scripts/check-verification-matrix.ts

Output: JSON report verifying that the maintained verification matrix still covers the public HiveAPI surface and package-level betting helper exports.
Exit codes: 0 = matrix covers the current surface, 1 = missing methods/helpers`);
  process.exit(0);
}

const hivePath = resolve(PACKAGE_ROOT, "src", "hive.ts");
const matrixPath = resolve(PACKAGE_ROOT, "references", "verification-matrix.md");

const hiveSource = readFileSync(hivePath, "utf8");
const matrixSource = readFileSync(matrixPath, "utf8");

const hiveMethods = extractHiveMethods(hiveSource);
const matrixMethods = extractBacktickedIdentifiers(matrixSource);
const helperExports = [
  "VALID_BET_HORIZONS",
  "buildBetMemo",
  "buildBinaryBetMemo",
  "buildHigherLowerMemo",
];

const missingHiveMethods = hiveMethods.filter((name) => !matrixMethods.has(name));
const missingHelperExports = helperExports.filter((name) => !matrixMethods.has(name));
const ok = missingHiveMethods.length === 0 && missingHelperExports.length === 0;

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  ok,
  hiveMethodCount: hiveMethods.length,
  helperExportCount: helperExports.length,
  missingHiveMethods,
  missingHelperExports,
}, null, 2));

process.exit(ok ? 0 : 1);

function extractHiveMethods(source: string): string[] {
  const interfaceMatch = source.match(/export interface HiveAPI \{([\s\S]*?)\n\}/);
  if (!interfaceMatch) {
    throw new Error("HiveAPI interface block not found in src/hive.ts");
  }

  return [...interfaceMatch[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\(/gm)]
    .map((match) => match[1])
    .filter((name) => name !== "Promise")
    .sort();
}

function extractBacktickedIdentifiers(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)]
      .map((match) => match[1]),
  );
}
