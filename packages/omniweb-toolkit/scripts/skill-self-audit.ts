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
import { builtinModules } from "node:module";
import { relative, resolve } from "node:path";
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
const readmePath = resolve(packageRoot, "README.md");
const toolkitPath = resolve(packageRoot, "TOOLKIT.md");
const referencesDir = resolve(packageRoot, "references");
const scriptsDir = resolve(packageRoot, "scripts");
const assetsDir = resolve(packageRoot, "assets");
const playbooksDir = resolve(packageRoot, "playbooks");
const docsDir = resolve(packageRoot, "docs");
const openaiYamlPath = resolve(packageRoot, "agents", "openai.yaml");
const repoRoot = resolve(packageRoot, "..", "..");
const repoLockPath = resolve(repoRoot, "package-lock.json");

const skillText = readFileSync(skillPath, "utf8");
const guideText = readFileSync(guidePath, "utf8");
const readmeText = readFileSync(readmePath, "utf8");
const toolkitText = readFileSync(toolkitPath, "utf8");
const openaiYamlText = existsRelative(packageRoot, "agents/openai.yaml")
  ? readFileSync(openaiYamlPath, "utf8")
  : "";
const packageJsonText = readFileSync(resolve(packageRoot, "package.json"), "utf8");
const packageJson = JSON.parse(packageJsonText) as {
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: Record<string, { import?: string; types?: string }>;
  homepage?: string;
  bugs?: { url?: string };
  repository?: { type?: string; url?: string; directory?: string } | string;
  license?: string;
};
const repoLock = existsRelative(repoRoot, "package-lock.json")
  ? JSON.parse(readFileSync(repoLockPath, "utf8")) as {
      packages?: Record<string, {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      }>;
    }
  : null;
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
const distDir = resolve(packageRoot, "dist");
const bundledMarkdownFiles = collectMarkdownFiles(packageRoot);

const skillFrontmatter = parseFrontmatter(skillText);
const skillLinks = extractRelativeLinks(skillText);
const guideLinks = extractRelativeLinks(guideText);
const readmeLinks = extractRelativeLinks(readmeText);
const toolkitLinks = extractRelativeLinks(toolkitText);
const topLevelReferenceFiles = listTopLevelFiles(referencesDir, ".md");
const topLevelScriptFiles = listTopLevelFiles(scriptsDir)
  .filter((name) => (name.endsWith(".ts") || name.endsWith(".sh")) && !name.startsWith("_"))
  .sort();
const topLevelAssetFiles = listTopLevelFiles(assetsDir)
  .filter((name) => !name.startsWith("."));
const topLevelScriptContents = topLevelScriptFiles.map((name) => ({
  name,
  text: readFileSync(resolve(scriptsDir, name), "utf8"),
}));
const evalScriptFiles = listTopLevelFiles(resolve(packageRoot, "evals"))
  .filter((name) => name.endsWith(".ts"))
  .sort();
const evalScriptContents = evalScriptFiles.map((name) => ({
  name,
  text: readFileSync(resolve(packageRoot, "evals", name), "utf8"),
}));
const scriptHelpChecks = topLevelScriptContents.map(({ name, text }) => ({
  name,
  ok: text.includes("--help") && /Usage:/i.test(text),
  detail: text.includes("--help") && /Usage:/i.test(text)
    ? undefined
    : "missing explicit --help handling or Usage text",
}));
const referenceFrontmatterChecks = topLevelReferenceFiles.map((name) => {
  const text = readFileSync(resolve(referencesDir, name), "utf8");
  const parsed = parseFrontmatter(text);
  return {
    name,
    ok: !!parsed && typeof parsed.summary === "string" && parsed.summary.length > 0 && typeof parsed.read_when === "string",
  };
});
const declaredRuntimeModules = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
]);
const scriptRuntimeImports = [...topLevelScriptContents, ...evalScriptContents].flatMap(({ name, text }) =>
  collectExternalImportsFromText(text).map((specifier) => ({
    file: name,
    specifier,
  })));
const undeclaredScriptRuntimeImports = scriptRuntimeImports
  .filter(({ specifier }) => !isDeclaredModule(specifier, declaredRuntimeModules))
  .map(({ file, specifier }) => `${file}: ${specifier}`);
const externalRuntimeImports = existsRelative(packageRoot, "dist")
  ? collectExternalImports(distDir)
  : [];
const undeclaredRuntimeImports = externalRuntimeImports.filter((specifier) => !isDeclaredModule(specifier, declaredRuntimeModules));
const workspaceLockEntry = repoLock?.packages?.["packages/omniweb-toolkit"];
const workspaceLockMatchesManifest =
  !repoLock ||
  normalizeRecord(workspaceLockEntry?.dependencies) === normalizeRecord(packageJson.dependencies) &&
  normalizeRecord(workspaceLockEntry?.peerDependencies) === normalizeRecord(packageJson.peerDependencies);
const undocumentedPeerDependencies = Object.keys(packageJson.peerDependencies ?? {})
  .filter((name) => !readmeText.includes(name));
const brokenBundledMarkdownLinks = bundledMarkdownFiles.flatMap((filePath) => {
  const text = readFileSync(filePath, "utf8");
  const links = extractRelativeLinks(text);
  return links
    .filter((link) => !existsFromFile(filePath, link))
    .map((link) => `${relative(packageRoot, filePath)} -> ${link}`);
});

const brokenLinks = [...new Set([...skillLinks, ...guideLinks, ...readmeLinks, ...toolkitLinks])]
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
const repoOnlyReadmeLinks = [
  "docs/research-supercolony-skill-sources.md",
  "docs/skill-improvement-recommendations.md",
].filter((target) => readmeLinks.includes(target));
const repoOnlyToolkitLinks = [
  "docs/research-supercolony-skill-sources.md",
  "docs/skill-improvement-recommendations.md",
].filter((target) => toolkitLinks.includes(target));
const shippedScriptImportViolations = topLevelScriptContents
  .filter(({ text }) => {
    const hasSourceImport = /\bfrom\s+["']\.\.\/src\/|import\(["']\.\.\/src\//.test(text);
    const hasDistImport = /\bfrom\s+["']\.\.\/dist\/|import\(["']\.\.\/dist\//.test(text);
    return hasSourceImport && !hasDistImport;
  })
  .map(({ name }) => name);
const exportTargets = Object.entries(packageJson.exports ?? {}).flatMap(([subpath, value]) => {
  if (subpath === ".") return [];
  return [subpath, value.import, value.types].filter((entry): entry is string => typeof entry === "string");
});
const docCorpus = [readmeText, toolkitText].join("\n");
const undocumentedExportSubpaths = Object.keys(packageJson.exports ?? {})
  .filter((subpath) => subpath !== ".")
  .map((subpath) => subpath.replace(/^\.\//, "omniweb-toolkit/"))
  .filter((label) => !docCorpus.includes(label));

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
    name: "readme_line_count",
    ok: lineCount(readmeText) <= 500,
    detail: `README.md has ${lineCount(readmeText)} lines`,
  },
  {
    name: "broken_relative_links",
    ok: brokenLinks.length === 0,
    detail: brokenLinks,
  },
  {
    name: "bundled_markdown_links_resolve",
    ok: brokenBundledMarkdownLinks.length === 0,
    detail: brokenBundledMarkdownLinks,
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
    name: "package_publish_metadata_present",
    ok:
      typeof packageJson.homepage === "string" &&
      packageJson.homepage.length > 0 &&
      typeof packageJson.bugs?.url === "string" &&
      packageJson.bugs.url.length > 0 &&
      (
        typeof packageJson.repository === "string"
          ? packageJson.repository.length > 0
          : typeof packageJson.repository?.url === "string" && packageJson.repository.url.length > 0
      ) &&
      typeof packageJson.license === "string" &&
      packageJson.license.length > 0,
    detail: "package.json should declare homepage, bugs.url, repository, and license for publish readiness",
  },
  {
    name: "shipped_typescript_scripts_have_runtime",
    ok: topLevelScriptFiles.every((name) => !name.endsWith(".ts")) || typeof packageJson.dependencies?.tsx === "string",
    detail: "package.json should declare tsx when shipping top-level .ts scripts for package consumers",
  },
  {
    name: "dist_runtime_imports_are_declared",
    ok: undeclaredRuntimeImports.length === 0,
    detail: undeclaredRuntimeImports.length === 0
      ? "all bare-module imports found in dist/ are declared in dependencies or peerDependencies"
      : undeclaredRuntimeImports,
  },
  {
    name: "script_runtime_imports_are_declared",
    ok: undeclaredScriptRuntimeImports.length === 0,
    detail: undeclaredScriptRuntimeImports.length === 0
      ? "all bare-module imports used by shipped scripts and eval helpers are declared"
      : undeclaredScriptRuntimeImports,
  },
  {
    name: "workspace_lock_matches_package_manifest",
    ok: workspaceLockMatchesManifest,
    detail: repoLock
      ? "root package-lock.json workspace metadata should match this package's dependencies and peerDependencies"
      : "package-lock.json not present at repo root; skipped",
  },
  {
    name: "readme_mentions_peer_dependencies",
    ok: undocumentedPeerDependencies.length === 0,
    detail: undocumentedPeerDependencies,
  },
  {
    name: "package_files_do_not_ship_repo_only_research",
    ok: !packageJson.files?.includes("docs/"),
    detail: "package.json files should not broadly include docs/ because repo-only research docs should not ship in the tarball",
  },
  {
    name: "package_subpath_exports_are_documented",
    ok: undocumentedExportSubpaths.length === 0,
    detail: undocumentedExportSubpaths,
  },
  {
    name: "readme_avoids_repo_only_links",
    ok: repoOnlyReadmeLinks.length === 0,
    detail: repoOnlyReadmeLinks,
  },
  {
    name: "toolkit_avoids_repo_only_links",
    ok: repoOnlyToolkitLinks.length === 0,
    detail: repoOnlyToolkitLinks,
  },
  {
    name: "shipped_scripts_avoid_repo_only_imports",
    ok: shippedScriptImportViolations.length === 0,
    detail: shippedScriptImportViolations.length === 0
      ? "top-level shipped scripts either avoid repo-only imports or provide a dist fallback"
      : shippedScriptImportViolations,
  },
  {
    name: "toolkit_mentions_release_and_live_shell_checks",
    ok: toolkitText.includes("scripts/check-live.sh") && toolkitText.includes("scripts/check-release.sh"),
    detail: "TOOLKIT.md should surface shell smoke and release checks alongside the TypeScript checks",
  },
  {
    name: "top_level_scripts_support_help",
    ok: scriptHelpChecks.every((entry) => entry.ok),
    detail: scriptHelpChecks.filter((entry) => !entry.ok),
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

function existsFromFile(sourcePath: string, relativeTarget: string): boolean {
  try {
    return statSync(resolve(sourcePath, "..", relativeTarget)).isFile();
  } catch {
    return false;
  }
}

function listTopLevelFiles(dir: string, extension?: string): string[] {
  return readdirSync(dir)
    .filter((name) => !extension || name.endsWith(extension))
    .sort();
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "dist" || entry.name === "node_modules") {
          continue;
        }
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function collectExternalImports(dir: string): string[] {
  const found = new Set<string>();
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        continue;
      }

      const text = readFileSync(fullPath, "utf8");
      for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier.startsWith(".") || specifier.startsWith("node:")) {
          continue;
        }
        found.add(specifier);
      }
      for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        const specifier = match[1];
        if (specifier.startsWith(".") || specifier.startsWith("node:")) {
          continue;
        }
        found.add(specifier);
      }
      for (const match of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']+)["'][\s\S]{0,800}?import\(\s*(?:\/\*[\s\S]*?\*\/\s*)?\1\s*\)/g)) {
        const specifier = match[2];
        if (specifier.startsWith(".") || specifier.startsWith("node:")) {
          continue;
        }
        found.add(specifier);
      }
    }
  }

  return [...found].sort();
}

function collectExternalImportsFromText(text: string): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith(".") || specifier.startsWith("node:")) {
      continue;
    }
    found.add(specifier);
  }
  for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith(".") || specifier.startsWith("node:")) {
      continue;
    }
    found.add(specifier);
  }

  return [...found].sort();
}

function isDeclaredModule(specifier: string, declared: Set<string>): boolean {
  const builtinRoots = new Set(builtinModules.map((name) => name.replace(/^node:/, "").split("/")[0]));
  const bareRoot = specifier.replace(/^node:/, "").split("/")[0];
  if (builtinRoots.has(bareRoot)) {
    return true;
  }

  if (declared.has(specifier)) {
    return true;
  }

  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return declared.has(`${scope}/${name}`);
  }

  const [name] = specifier.split("/");
  return declared.has(name);
}

function normalizeRecord(record: Record<string, string> | undefined): string {
  return JSON.stringify(Object.fromEntries(Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b))));
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}
