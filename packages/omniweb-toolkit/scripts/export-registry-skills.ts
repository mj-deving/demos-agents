#!/usr/bin/env npx tsx

import { resolve } from "node:path";
import { getStringArg, hasFlag } from "./_shared.js";
import {
  isArchetype,
  REGISTRY_EXPORT_ROOT,
  SUPPORTED_ARCHETYPES,
  type Archetype,
  writeRegistryExport,
} from "./_registry-export.js";

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/export-registry-skills.ts [options]

Options:
  --output-dir PATH   Destination directory (default: agents/registry)
  --archetype NAME    Export only one archetype
  --help, -h          Show this help

Output: JSON report describing the files written
Exit codes: 0 = export succeeded, 2 = invalid args`);
  process.exit(0);
}

const archetypeArg = getStringArg(args, "--archetype");
const outputDir = resolve(getStringArg(args, "--output-dir") ?? REGISTRY_EXPORT_ROOT);

if (archetypeArg && !isArchetype(archetypeArg)) {
  console.error(`Error: --archetype must be one of ${SUPPORTED_ARCHETYPES.join(", ")}`);
  process.exit(2);
}

const archetypes: readonly Archetype[] = archetypeArg ? [archetypeArg] : SUPPORTED_ARCHETYPES;
const files = writeRegistryExport(outputDir, archetypes);

console.log(JSON.stringify({
  ok: true,
  outputDir,
  archetypes,
  fileCount: files.length,
  files: files.map((file) => file.path),
}, null, 2));
