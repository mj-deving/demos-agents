#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStringArg, hasFlag } from "./_shared.js";
import {
  buildRegistryExport,
  collectTextFiles,
  extractRelativeMarkdownLinks,
  isArchetype,
  parseFrontmatter,
  REGISTRY_EXPORT_ROOT,
  SUPPORTED_ARCHETYPES,
  type Archetype,
} from "./_registry-export.js";
import { getArchetypeSpec } from "./_openclaw-export.js";

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-registry-export.ts [options]

Options:
  --output-dir PATH   Export directory to validate (default: agents/registry)
  --archetype NAME    Validate only one archetype
  --help, -h          Show this help

Output: JSON report covering export drift, frontmatter, install guidance, and relative-link integrity
Exit codes: 0 = export is valid, 1 = drift or validation failure, 2 = invalid args`);
  process.exit(0);
}

const archetypeArg = getStringArg(args, "--archetype");
const outputDir = resolve(getStringArg(args, "--output-dir") ?? REGISTRY_EXPORT_ROOT);

if (archetypeArg && !isArchetype(archetypeArg)) {
  console.error(`Error: --archetype must be one of ${SUPPORTED_ARCHETYPES.join(", ")}`);
  process.exit(2);
}

const archetypes: readonly Archetype[] = archetypeArg ? [archetypeArg] : SUPPORTED_ARCHETYPES;
const expectedFiles = buildRegistryExport(archetypes)
  .filter((file) => !archetypeArg || file.path !== "README.md");
const allowedPrefixes = new Set([
  ...archetypes.map((archetype) => `${getArchetypeSpec(archetype).skillName}/`),
  ...(archetypeArg ? [] : ["README.md"]),
]);
const actualFiles = collectTextFiles(outputDir)
  .filter((file) => Array.from(allowedPrefixes).some((prefix) => (
    prefix.endsWith("/") ? file.path.startsWith(prefix) : file.path === prefix
  )));
const expectedMap = new Map(expectedFiles.map((file) => [file.path, file.content]));
const actualMap = new Map(actualFiles.map((file) => [file.path, file.content]));

const missingFiles = expectedFiles.map((file) => file.path).filter((path) => !actualMap.has(path));
const unexpectedFiles = actualFiles.map((file) => file.path).filter((path) => !expectedMap.has(path));
const changedFiles = expectedFiles
  .map((file) => file.path)
  .filter((path) => actualMap.has(path) && actualMap.get(path) !== expectedMap.get(path));

const skillChecks = archetypes.map((archetype) => {
  const spec = getArchetypeSpec(archetype);
  const skillDir = resolve(outputDir, spec.skillName);
  const skillPath = resolve(skillDir, "SKILL.md");
  const runbookPath = resolve(skillDir, "RUNBOOK.md");
  const readmePath = resolve(skillDir, "README.md");
  const frontmatter = existsSync(skillPath)
    ? parseFrontmatter(readFileSync(skillPath, "utf8"))
    : null;
  const skillLinks = existsSync(skillPath)
    ? extractRelativeMarkdownLinks(readFileSync(skillPath, "utf8"))
    : [];
  const guideLinks = existsSync(resolve(skillDir, "GUIDE.md"))
    ? extractRelativeMarkdownLinks(readFileSync(resolve(skillDir, "GUIDE.md"), "utf8"))
    : [];
  const brokenLinks = [...new Set([...skillLinks, ...guideLinks])]
    .filter((link) => !existsSync(resolve(skillDir, link)));
  const runbookText = existsSync(runbookPath)
    ? readFileSync(runbookPath, "utf8")
    : "";
  const readmeText = existsSync(readmePath)
    ? readFileSync(readmePath, "utf8")
    : "";
  const metadata = isRecord(frontmatter?.metadata) ? frontmatter?.metadata : null;
  const openclaw = metadata && isRecord(metadata.openclaw) ? metadata.openclaw : null;
  const requires = openclaw && isRecord(openclaw.requires) ? openclaw.requires : null;
  const bins = Array.isArray(requires?.bins) ? requires.bins : [];
  const anyBins = Array.isArray(requires?.anyBins) ? requires.anyBins : [];

  return {
    archetype,
    skillName: spec.skillName,
    ok: !!frontmatter &&
      frontmatter.name === spec.skillName &&
      typeof frontmatter.description === "string" &&
      typeof frontmatter.version === "string" &&
      typeof openclaw?.skillKey === "string" &&
      openclaw.skillKey === spec.skillName &&
      typeof openclaw.homepage === "string" &&
      openclaw.homepage.includes("omniweb-agents") &&
      bins.includes("node") &&
      anyBins.some((value) => value === "npm" || value === "pnpm" || value === "yarn") &&
      brokenLinks.length === 0 &&
      runbookText.includes("npm install omniweb-toolkit@") &&
      runbookText.includes("check-playbook-path.ts") &&
      readmeText.includes("publish-facing skill artifact"),
    frontmatterName: frontmatter?.name ?? null,
    version: frontmatter?.version ?? null,
    brokenLinks,
    homepage: typeof openclaw?.homepage === "string" ? openclaw.homepage : null,
    bins,
    anyBins,
  };
});

const ok =
  missingFiles.length === 0 &&
  unexpectedFiles.length === 0 &&
  changedFiles.length === 0 &&
  skillChecks.every((check) => check.ok);

console.log(JSON.stringify({
  ok,
  outputDir,
  archetypes,
  expectedFileCount: expectedFiles.length,
  actualFileCount: actualFiles.length,
  missingFiles,
  unexpectedFiles,
  changedFiles,
  skillChecks,
}, null, 2));

process.exit(ok ? 0 : 1);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
