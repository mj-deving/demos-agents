#!/usr/bin/env npx tsx
/**
 * skill-self-audit.ts — Validate progressive-disclosure hygiene for this skill package.
 *
 * AgentSkills spec: non-interactive, structured output, --help, deterministic.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = audit passes, 1 = audit failure, 2 = invalid args.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  PACKAGE_ROOT,
  getStringArg,
  hasFlag,
} from "./_shared.js";

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/skill-self-audit.ts [--package-root PATH]

Options:
  --package-root PATH  Skill package root (default: current package root)
  --help, -h           Show this help

Output: JSON report covering frontmatter, line counts, link integrity, and reference discoverability
Exit codes: 0 = pass, 1 = audit failure, 2 = invalid args`);
  process.exit(0);
}

const packageRoot = resolve(getStringArg(args, "--package-root") ?? PACKAGE_ROOT);
const skillPath = resolve(packageRoot, "SKILL.md");
const guidePath = resolve(packageRoot, "GUIDE.md");
const referencesDir = resolve(packageRoot, "references");
const scriptsDir = resolve(packageRoot, "scripts");
const assetsDir = resolve(packageRoot, "assets");
const openaiYamlPath = resolve(packageRoot, "agents", "openai.yaml");

const skillText = readFileSync(skillPath, "utf8");
const guideText = readFileSync(guidePath, "utf8");
const openaiYamlText = existsRelative(packageRoot, "agents/openai.yaml")
  ? readFileSync(openaiYamlPath, "utf8")
  : "";

const skillFrontmatter = parseFrontmatter(skillText);
const skillLinks = extractRelativeLinks(skillText);
const guideLinks = extractRelativeLinks(guideText);
const topLevelReferenceFiles = listTopLevelFiles(referencesDir, ".md");
const topLevelScriptFiles = listTopLevelFiles(scriptsDir, ".ts")
  .filter((name) => !name.startsWith("_"));
const topLevelAssetFiles = listTopLevelFiles(assetsDir)
  .filter((name) => !name.startsWith("."));

const brokenLinks = [...new Set([...skillLinks, ...guideLinks])]
  .filter((link) => !existsRelative(packageRoot, link));

const oneLevelViolations = skillLinks.filter((link) => {
  if (!link.startsWith("references/") && !link.startsWith("scripts/") && !link.startsWith("playbooks/")) {
    return false;
  }

  return link.split("/").length !== 2;
});

const missingReferenceMentions = topLevelReferenceFiles
  .map((name) => `references/${name}`)
  .filter((target) => !skillLinks.includes(target));

const missingScriptMentions = topLevelScriptFiles
  .map((name) => `scripts/${name}`)
  .filter((target) => !skillLinks.includes(target));

const missingAssetMentions = topLevelAssetFiles
  .map((name) => `assets/${name}`)
  .filter((target) => !skillLinks.includes(target) && !guideLinks.includes(target));

const checks = [
  {
    name: "skill_frontmatter",
    ok: !!skillFrontmatter &&
      typeof skillFrontmatter.name === "string" &&
      typeof skillFrontmatter.description === "string",
    detail: "SKILL.md must contain frontmatter with name and description",
  },
  {
    name: "skill_line_count",
    ok: lineCount(skillText) <= 500,
    detail: `SKILL.md has ${lineCount(skillText)} lines`,
  },
  {
    name: "guide_line_count",
    ok: lineCount(guideText) <= 500,
    detail: `GUIDE.md has ${lineCount(guideText)} lines`,
  },
  {
    name: "broken_relative_links",
    ok: brokenLinks.length === 0,
    detail: brokenLinks,
  },
  {
    name: "one_level_references",
    ok: oneLevelViolations.length === 0,
    detail: oneLevelViolations,
  },
  {
    name: "reference_discoverability",
    ok: missingReferenceMentions.length === 0,
    detail: missingReferenceMentions,
  },
  {
    name: "script_discoverability",
    ok: missingScriptMentions.length === 0,
    detail: missingScriptMentions,
  },
  {
    name: "asset_discoverability",
    ok: missingAssetMentions.length === 0,
    detail: missingAssetMentions,
  },
  {
    name: "openai_yaml_exists",
    ok: openaiYamlText.length > 0,
    detail: "agents/openai.yaml should exist",
  },
  {
    name: "openai_yaml_default_prompt",
    ok: openaiYamlText.includes("$omniweb-toolkit"),
    detail: "agents/openai.yaml default_prompt should mention $omniweb-toolkit",
  },
];

const ok = checks.every((check) => check.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  packageRoot,
  ok,
  counts: {
    skillLines: lineCount(skillText),
    guideLines: lineCount(guideText),
    referenceFiles: topLevelReferenceFiles.length,
    scriptFiles: topLevelScriptFiles.length,
    assetFiles: topLevelAssetFiles.length,
  },
  checks,
}, null, 2));

process.exit(ok ? 0 : 1);

function parseFrontmatter(text: string): Record<string, string> | null {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value;
  }

  return result;
}

function extractRelativeLinks(text: string): string[] {
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  const links = new Set<string>();

  for (const match of text.matchAll(pattern)) {
    const target = match[1];
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:") ||
      target.startsWith("#")
    ) {
      continue;
    }
    links.add(target);
  }

  return Array.from(links).sort();
}

function existsRelative(root: string, relativeTarget: string): boolean {
  try {
    return statSync(resolve(root, relativeTarget)).isFile();
  } catch {
    return false;
  }
}

function listTopLevelFiles(dir: string, extension?: string): string[] {
  return readdirSync(dir)
    .filter((name) => !extension || name.endsWith(extension))
    .sort();
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}
