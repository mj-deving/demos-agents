#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStringArg, hasFlag } from "./_shared.js";
import {
  buildOpenClawExport,
  collectTextFiles,
  extractRelativeMarkdownLinks,
  getArchetypeSpec,
  isArchetype,
  OPENCLAW_EXPORT_ROOT,
  parseFrontmatter,
  SUPPORTED_ARCHETYPES,
  type Archetype,
} from "./_openclaw-export.js";

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-openclaw-export.ts [options]

Options:
  --output-dir PATH   Export directory to validate (default: agents/openclaw)
  --archetype NAME    Validate only one archetype
  --help, -h          Show this help

Output: JSON report covering export drift, skill frontmatter, config wiring, and relative-link integrity
Exit codes: 0 = export is valid, 1 = drift or validation failure, 2 = invalid args`);
  process.exit(0);
}

const archetypeArg = getStringArg(args, "--archetype");
const outputDir = resolve(getStringArg(args, "--output-dir") ?? OPENCLAW_EXPORT_ROOT);

if (archetypeArg && !isArchetype(archetypeArg)) {
  console.error(`Error: --archetype must be one of ${SUPPORTED_ARCHETYPES.join(", ")}`);
  process.exit(2);
}

const archetypes: readonly Archetype[] = archetypeArg ? [archetypeArg] : SUPPORTED_ARCHETYPES;
const expectedFiles = buildOpenClawExport(archetypes)
  .filter((file) => !archetypeArg || file.path !== "README.md");
const allowedPrefixes = new Set([
  ...archetypes.map((archetype) => `${archetype}/`),
  ...(archetypeArg ? [] : ["README.md"]),
]);
const actualFiles = collectTextFiles(outputDir)
  .filter((file) => Array.from(allowedPrefixes).some((prefix) => (
    prefix.endsWith("/") ? file.path.startsWith(prefix) : file.path === prefix
  )));
const expectedMap = new Map(expectedFiles.map((file) => [file.path, file.content]));
const actualMap = new Map(actualFiles.map((file) => [file.path, file.content]));

const missingFiles = expectedFiles
  .map((file) => file.path)
  .filter((path) => !actualMap.has(path));
const unexpectedFiles = actualFiles
  .map((file) => file.path)
  .filter((path) => !expectedMap.has(path));
const changedFiles = expectedFiles
  .map((file) => file.path)
  .filter((path) => actualMap.has(path) && actualMap.get(path) !== expectedMap.get(path));

const bundleChecks = archetypes.map((archetype) => {
  const spec = getArchetypeSpec(archetype);
  const bundleRoot = resolve(outputDir, archetype);
  const skillDir = resolve(bundleRoot, "skills", spec.skillName);
  const skillPath = resolve(skillDir, "SKILL.md");
  const frontmatter = existsSync(skillPath)
    ? parseFrontmatter(readFileSync(skillPath, "utf8"))
    : null;
  const skillLinks = existsSync(skillPath)
    ? extractRelativeMarkdownLinks(readFileSync(skillPath, "utf8"))
    : [];
  const brokenLinks = skillLinks.filter((link) => !existsSync(resolve(skillDir, link)));
  const configPath = resolve(bundleRoot, "openclaw.json");
  const bundlePackagePath = resolve(bundleRoot, "package.json");
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8")) as {
        agents?: { defaults?: { skills?: unknown } };
        skills?: { entries?: Record<string, { enabled?: unknown }> };
      }
    : null;
  const bundlePackage = existsSync(bundlePackagePath)
    ? JSON.parse(readFileSync(bundlePackagePath, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
      }
    : null;

  const allowlist = config?.agents?.defaults?.skills;
  const enabledEntry = config?.skills?.entries?.[spec.skillName];
  const bundleScripts = bundlePackage?.scripts ?? {};
  const bundleDependency = bundlePackage?.dependencies?.["omniweb-toolkit"] ?? null;

  return {
    archetype,
    bundleRoot,
    ok: !!frontmatter &&
      frontmatter.name === spec.skillName &&
      typeof frontmatter.description === "string" &&
      brokenLinks.length === 0 &&
      Array.isArray(allowlist) &&
      allowlist.length === 1 &&
      allowlist[0] === spec.skillName &&
      enabledEntry?.enabled === true &&
      bundleScripts["check:playbook"]?.includes(spec.id) === true &&
      typeof bundleScripts["check:attestation"] === "string" &&
      typeof bundleScripts["check:bundle"] === "string" &&
      bundleDependency === "file:../../..",
    frontmatterName: frontmatter?.name ?? null,
    brokenLinks,
    allowlist,
    enabledEntry: enabledEntry ?? null,
    dependency: bundleDependency,
    scripts: bundleScripts,
  };
});

const ok =
  missingFiles.length === 0 &&
  unexpectedFiles.length === 0 &&
  changedFiles.length === 0 &&
  bundleChecks.every((check) => check.ok);

console.log(JSON.stringify({
  ok,
  outputDir,
  archetypes,
  expectedFileCount: expectedFiles.length,
  actualFileCount: actualFiles.length,
  missingFiles,
  unexpectedFiles,
  changedFiles,
  bundleChecks,
}, null, 2));

process.exit(ok ? 0 : 1);
