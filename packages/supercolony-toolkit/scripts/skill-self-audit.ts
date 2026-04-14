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
const toolkitPath = resolve(packageRoot, "TOOLKIT.md");
const referencesDir = resolve(packageRoot, "references");
const scriptsDir = resolve(packageRoot, "scripts");
const assetsDir = resolve(packageRoot, "assets");
const playbooksDir = resolve(packageRoot, "playbooks");
const docsDir = resolve(packageRoot, "docs");
const openaiYamlPath = resolve(packageRoot, "agents", "openai.yaml");

const skillText = readFileSync(skillPath, "utf8");
const guideText = readFileSync(guidePath, "utf8");
const toolkitText = readFileSync(toolkitPath, "utf8");
const openaiYamlText = existsRelative(packageRoot, "agents/openai.yaml")
  ? readFileSync(openaiYamlPath, "utf8")
  : "";
const packageJsonText = readFileSync(resolve(packageRoot, "package.json"), "utf8");
const packageJson = JSON.parse(packageJsonText) as {
  files?: string[];
  scripts?: Record<string, string>;
};
const playbookTexts = readdirSync(playbooksDir)
  .filter((name) => name.endsWith(".md") || name.endsWith(".yaml"))
  .map((name) => readFileSync(resolve(playbooksDir, name), "utf8"));
const compatibilityDocPaths = [
  resolve(docsDir, "attestation-pipeline.md"),
  resolve(docsDir, "capabilities-guide.md"),
  resolve(docsDir, "ecosystem-guide.md"),
  resolve(docsDir, "primitives", "README.md"),
];
const compatibilityDocs = compatibilityDocPaths.map((path) => readFileSync(path, "utf8"));

const skillFrontmatter = parseFrontmatter(skillText);
const skillLinks = extractRelativeLinks(skillText);
const guideLinks = extractRelativeLinks(guideText);
const toolkitLinks = extractRelativeLinks(toolkitText);
const topLevelReferenceFiles = listTopLevelFiles(referencesDir, ".md");
const topLevelScriptFiles = listTopLevelFiles(scriptsDir, ".ts")
  .filter((name) => !name.startsWith("_"));
const topLevelAssetFiles = listTopLevelFiles(assetsDir)
  .filter((name) => !name.startsWith("."));
const referenceFrontmatterChecks = topLevelReferenceFiles.map((name) => {
  const text = readFileSync(resolve(referencesDir, name), "utf8");
  const parsed = parseFrontmatter(text);
  return {
    name,
    ok: !!parsed && typeof parsed.summary === "string" && parsed.summary.length > 0 && typeof parsed.read_when === "string",
  };
});

const brokenLinks = [...new Set([...skillLinks, ...guideLinks, ...toolkitLinks])]
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
  .filter((target) => !skillLinks.includes(target) && !guideLinks.includes(target) && !toolkitLinks.includes(target));

const stalePatterns = [
  { label: "stale docs links", ok: !toolkitText.includes("docs/ecosystem-guide.md") && !toolkitText.includes("docs/capabilities-guide.md") && !toolkitText.includes("docs/attestation-pipeline.md") },
  { label: "obsolete NEWS category", ok: playbookTexts.every((text) => !text.includes("NEWS:")) },
];

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
  {
    name: "toolkit_links_current",
    ok: stalePatterns[0].ok,
    detail: stalePatterns[0].label,
  },
  {
    name: "playbook_categories_current",
    ok: stalePatterns[1].ok,
    detail: stalePatterns[1].label,
  },
  {
    name: "package_files_include_skill_assets",
    ok: ["agents/", "assets/", "references/", "scripts/"].every((entry) => packageJson.files?.includes(entry)),
    detail: "package.json files should include agents/, assets/, references/, and scripts/",
  },
  {
    name: "prepack_does_not_overwrite_references",
    ok: typeof packageJson.scripts?.prepack === "string" &&
      !packageJson.scripts.prepack.includes("cp docs/") &&
      !packageJson.scripts.prepack.includes("references/"),
    detail: "package.json prepack should not overwrite references/",
  },
  {
    name: "docs_are_compatibility_stubs",
    ok: compatibilityDocs.every((text) => text.includes("Compatibility Note:") && text.includes("../references/") || text.includes("../../references/")),
    detail: "legacy docs/ copies should redirect to canonical references/",
  },
  {
    name: "reference_frontmatter_complete",
    ok: referenceFrontmatterChecks.every((entry) => entry.ok),
    detail: referenceFrontmatterChecks.filter((entry) => !entry.ok).map((entry) => entry.name),
  },
  {
    name: "compatibility_docs_are_short",
    ok: compatibilityDocs.every((text) => lineCount(text) <= 12),
    detail: "legacy docs/ stubs should stay short",
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
