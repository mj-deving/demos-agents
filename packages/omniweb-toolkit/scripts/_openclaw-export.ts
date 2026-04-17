#!/usr/bin/env npx tsx

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { PACKAGE_ROOT } from "./_shared.js";

export const SUPPORTED_ARCHETYPES = [
  "research-agent",
  "market-analyst",
  "engagement-optimizer",
] as const;

export type Archetype = typeof SUPPORTED_ARCHETYPES[number];

export interface ExportedFile {
  path: string;
  content: string;
}

interface ArchetypeSpec {
  id: Archetype;
  displayName: string;
  skillName: string;
  emoji: string;
  theme: string;
  summary: string;
  bundlePackageName: string;
  playbookPath: string;
  starterPath: string;
  starterExportName: string;
  trajectoryScenario: string;
  playbookCheckScript: string;
  runTemplateScript: string;
  starterGoal: string;
  starterCheckNote: string;
  observeFocus: string[];
  actionPriorities: string[];
  references: string[];
}

const ARCHETYPE_SPECS: Record<Archetype, ArchetypeSpec> = {
  "research-agent": {
    id: "research-agent",
    displayName: "OmniWeb Research Agent",
    skillName: "omniweb-research-agent",
    emoji: "🔬",
    theme: "Evidence-led SuperColony researcher who values depth over speed.",
    summary: "Deep research analyst contributing evidence-backed SuperColony analysis with strong attestation discipline.",
    bundlePackageName: "@omniweb-toolkit/openclaw-research-agent-bundle",
    playbookPath: "playbooks/research-agent.md",
    starterPath: "assets/research-agent-starter.ts",
    starterExportName: "runResearchAgentCycle",
    trajectoryScenario: "research-agent-playbook",
    playbookCheckScript: "check:playbook:research",
    runTemplateScript: "node --import tsx ./node_modules/omniweb-toolkit/evals/score-playbook-run.ts --template research-agent",
    starterGoal: "coverage-gap detection plus evidence-backed publishing",
    starterCheckNote: "Keep publishes gated by attestation workflow checks before spending DEM.",
    observeFocus: [
      "getFeed({ limit: 30 })",
      "getSignals()",
      "getLeaderboard({ limit: 10 })",
      "getBalance()",
    ],
    actionPriorities: [
      "Publish when a high-confidence signal is under-covered or contradictory.",
      "React or tip when another agent contributes novel evidence worth amplifying.",
      "Skip when there is no fresh gap, when you published within the last hour, or when balance is below the playbook floor.",
    ],
    references: [
      "GUIDE.md",
      "references/attestation-pipeline.md",
      "references/publish-proof-protocol.md",
      "references/research-agent-launch-proof-2026-04-17.md",
      "references/verification-matrix.md",
      "references/launch-proving-matrix.md",
      "references/read-surface-sweep.md",
      "references/social-write-sweep-2026-04-17.md",
      "references/write-surface-sweep.md",
      "references/toolkit-guardrails.md",
      "references/categories.md",
    ],
  },
  "market-analyst": {
    id: "market-analyst",
    displayName: "OmniWeb Market Analyst",
    skillName: "omniweb-market-analyst",
    emoji: "📈",
    theme: "Fast SuperColony market analyst focused on divergences, signals, and disciplined conviction.",
    summary: "Signals-driven SuperColony market analyst that publishes divergence analysis and only bets after the publish path is proven.",
    bundlePackageName: "@omniweb-toolkit/openclaw-market-analyst-bundle",
    playbookPath: "playbooks/market-analyst.md",
    starterPath: "assets/market-analyst-starter.ts",
    starterExportName: "runMarketAnalystCycle",
    trajectoryScenario: "market-analyst-playbook",
    playbookCheckScript: "check:playbook:market",
    runTemplateScript: "node --import tsx ./node_modules/omniweb-toolkit/evals/score-playbook-run.ts --template market-analyst",
    starterGoal: "oracle-divergence detection and publish-first market response",
    starterCheckNote: "Do not enable live bets until the read surface and publish path are stable on the current host.",
    observeFocus: [
      "getSignals()",
      "getOracle({ assets })",
      "getPrices(assets)",
      "getFeed({ limit: 20 })",
      "getBalance()",
    ],
    actionPriorities: [
      "Publish when a fresh oracle divergence clears the configured threshold.",
      "Bet only after the divergence-driven publish path is working and the live pool surface has been probed.",
      "React or tip to reinforce high-quality attested market takes when they add signal rather than noise.",
    ],
    references: [
      "GUIDE.md",
      "references/response-shapes.md",
      "references/toolkit-guardrails.md",
      "references/categories.md",
    ],
  },
  "engagement-optimizer": {
    id: "engagement-optimizer",
    displayName: "OmniWeb Engagement Optimizer",
    skillName: "omniweb-engagement-optimizer",
    emoji: "🤝",
    theme: "Community-focused SuperColony curator who rewards quality and avoids spammy engagement loops.",
    summary: "Community-centric SuperColony agent that curates the feed, reacts selectively, and tips with explicit budget discipline.",
    bundlePackageName: "@omniweb-toolkit/openclaw-engagement-optimizer-bundle",
    playbookPath: "playbooks/engagement-optimizer.md",
    starterPath: "assets/engagement-optimizer-starter.ts",
    starterExportName: "runEngagementOptimizerCycle",
    trajectoryScenario: "engagement-optimizer-playbook",
    playbookCheckScript: "check:playbook:engagement",
    runTemplateScript: "node --import tsx ./node_modules/omniweb-toolkit/evals/score-playbook-run.ts --template engagement-optimizer",
    starterGoal: "under-engaged quality-post detection plus selective reactions and tips",
    starterCheckNote: "Keep tipping selective and attach a concrete reason before spending DEM.",
    observeFocus: [
      "getFeed({ limit: 30 })",
      "getLeaderboard({ limit: 20 })",
      "getBalance()",
      "getReactions(txHash) for the most relevant posts",
    ],
    actionPriorities: [
      "React when a quality post is under-engaged or when a newcomer deserves reinforcement.",
      "Tip only after a budget check and only when the contribution is genuinely useful.",
      "Publish occasionally to synthesize what the colony is learning, not to pad volume.",
    ],
    references: [
      "GUIDE.md",
      "references/scoring-and-leaderboard.md",
      "references/response-shapes.md",
      "references/categories.md",
    ],
  },
};

export const OPENCLAW_EXPORT_ROOT = resolve(PACKAGE_ROOT, "agents", "openclaw");

export function isArchetype(value: string): value is Archetype {
  return (SUPPORTED_ARCHETYPES as readonly string[]).includes(value);
}

export function getArchetypeSpec(archetype: Archetype): ArchetypeSpec {
  return ARCHETYPE_SPECS[archetype];
}

export function buildOpenClawExport(archetypes: readonly Archetype[] = SUPPORTED_ARCHETYPES): ExportedFile[] {
  const files: ExportedFile[] = [
    {
      path: "README.md",
      content: renderRootReadme(archetypes),
    },
  ];

  for (const archetype of archetypes) {
    const spec = getArchetypeSpec(archetype);
    const playbookText = rewritePlaybookLinks(readPackageFile(spec.playbookPath), spec);
    const starterText = readPackageFile(spec.starterPath);
    const minimalStarterText = readPackageFile("assets/minimal-agent-starter.mjs");
    const loopSkeletonText = readPackageFile("assets/agent-loop-skeleton.ts");
    const exampleTraceText = readPackageFile(`evals/examples/${spec.trajectoryScenario}.trace.json`);
    const strategyText = buildMergedStrategy(playbookText);
    const bundleDir = archetype;
    const skillDir = `${bundleDir}/skills/${spec.skillName}`;

    files.push(
      {
        path: `${bundleDir}/README.md`,
        content: renderBundleReadme(spec),
      },
      {
        path: `${bundleDir}/IDENTITY.md`,
        content: renderIdentity(spec),
      },
      {
        path: `${bundleDir}/openclaw.json`,
        content: renderOpenClawConfig(spec),
      },
      {
        path: `${bundleDir}/package.json`,
        content: renderBundlePackageJson(spec),
      },
      {
        path: `${skillDir}/SKILL.md`,
        content: renderSkill(spec),
      },
      {
        path: `${skillDir}/PLAYBOOK.md`,
        content: playbookText,
      },
      {
        path: `${skillDir}/strategy.yaml`,
        content: strategyText,
      },
      {
        path: `${skillDir}/GUIDE.md`,
        content: renderLocalGuide(spec),
      },
      {
        path: `${skillDir}/minimal-agent-starter.mjs`,
        content: normalizeText(minimalStarterText),
      },
      {
        path: `${skillDir}/agent-loop-skeleton.ts`,
        content: loopSkeletonText,
      },
      {
        path: `${skillDir}/starter.ts`,
        content: normalizeText(starterText),
      },
      {
        path: `${skillDir}/example.trace.json`,
        content: exampleTraceText,
      },
      {
        path: `${skillDir}/RUNBOOK.md`,
        content: renderRunbook(spec),
      },
    );

    for (const referencePath of spec.references.filter((path) => path.startsWith("references/"))) {
      files.push({
        path: `${skillDir}/references/${basename(referencePath)}`,
        content: rewriteReferenceLinks(readPackageFile(referencePath)),
      });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function writeOpenClawExport(
  outputDir: string,
  archetypes: readonly Archetype[] = SUPPORTED_ARCHETYPES,
): ExportedFile[] {
  const files = buildOpenClawExport(archetypes);
  rmSync(outputDir, { recursive: true, force: true });

  for (const file of files) {
    const targetPath = resolve(outputDir, file.path);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content, "utf8");
  }

  return files;
}

export function collectTextFiles(rootDir: string): ExportedFile[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files: ExportedFile[] = [];

  for (const entry of readdirSync(rootDir)) {
    const absolutePath = resolve(rootDir, entry);
    const entryStat = statSync(absolutePath);

    if (entryStat.isDirectory()) {
      files.push(...collectTextFiles(absolutePath).map((file) => ({
        path: relative(rootDir, resolve(absolutePath, file.path)),
        content: file.content,
      })));
      continue;
    }

    files.push({
      path: relative(rootDir, absolutePath).replace(/\\/g, "/"),
      content: normalizeText(readFileSync(absolutePath, "utf8")),
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function extractRelativeMarkdownLinks(text: string): string[] {
  const links = [...text.matchAll(/\[[^\]]+\]\((?!https?:|mailto:|#|\/)([^)]+)\)/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return Array.from(new Set(links));
}

export function parseFrontmatter(text: string): Record<string, unknown> | null {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const parsed = parse(match[1]);
  return isRecord(parsed) ? parsed : null;
}

function buildMergedStrategy(playbookText: string): string {
  const base = parse(readPackageFile("playbooks/strategy-schema.yaml")) as Record<string, unknown>;
  const overrideBlock = extractFirstYamlFence(playbookText);
  const override = parse(overrideBlock) as Record<string, unknown>;
  const merged = deepMerge(base, override);
  return `${stringify(merged).trimEnd()}\n`;
}

function rewritePlaybookLinks(text: string, spec: ArchetypeSpec): string {
  return normalizeText(text
    .replaceAll("../GUIDE.md", "./GUIDE.md")
    .replaceAll("../assets/minimal-agent-starter.mjs", "./minimal-agent-starter.mjs")
    .replaceAll("../assets/agent-loop-skeleton.ts", "./agent-loop-skeleton.ts")
    .replaceAll(`../assets/${basename(spec.starterPath)}`, "./starter.ts")
    .replaceAll("./strategy-schema.yaml", "./strategy.yaml")
    .replaceAll(`../evals/examples/${spec.trajectoryScenario}.trace.json`, "./example.trace.json")
    .replaceAll("../references/", "./references/"));
}

function extractFirstYamlFence(text: string): string {
  const match = text.match(/```yaml\n([\s\S]*?)```/);
  if (!match?.[1]) {
    throw new Error("Expected a yaml code fence in the playbook");
  }
  return match[1];
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(override)) {
    return override;
  }

  if (isRecord(base) && isRecord(override)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    }
    return merged;
  }

  return override;
}

function renderRootReadme(archetypes: readonly Archetype[]): string {
  const bullets = archetypes
    .map((archetype) => {
      const spec = getArchetypeSpec(archetype);
      return `- [${archetype}/README.md](./${archetype}/README.md) — ${spec.summary}`;
    })
    .join("\n");

  return normalizeText(`# OpenClaw Bundles

Generated OpenClaw workspace bundles for the shipped \`omniweb-toolkit\` archetypes.

The layout follows the current OpenClaw skill and workspace docs verified on April 16, 2026:

- workspace-local skills live in \`<workspace>/skills\`
- skill visibility is controlled by \`agents.defaults.skills\` in \`openclaw.json\`
- skill folders may include supporting text files in addition to \`SKILL.md\`

Available bundles:

${bullets}

Regenerate these files from the package root with:

\`\`\`bash
npm run export:openclaw
\`\`\`

Validate the committed export with:

\`\`\`bash
npm run check:openclaw
\`\`\`
`);
}

function renderBundleReadme(spec: ArchetypeSpec): string {
  return normalizeText(`# ${spec.displayName} OpenClaw Bundle

This directory is an OpenClaw workspace bundle for the \`${spec.id}\` archetype shipped by \`omniweb-toolkit\`.

## What It Includes

- \`openclaw.json\` — workspace config that exposes only \`${spec.skillName}\`
- \`IDENTITY.md\` — human-readable identity scaffold for the workspace's main agent
- \`package.json\` — local workspace package that points \`omniweb-toolkit\` at the checked-out package via \`file:../../..\`
- \`skills/${spec.skillName}/\` — the exported OpenClaw skill plus supporting files

## Local Usage

1. From this directory, run \`npm install\`.
2. Start OpenClaw with this folder as the workspace, or copy \`skills/${spec.skillName}\` into an existing workspace's \`skills/\` directory.
3. Verify the skill is visible with \`openclaw skills list\`.
4. Start a session and prompt the agent with a task that fits this archetype's role and action profile.

The local \`package.json\` assumes this bundle stays inside the checked-out repository. If you copy it elsewhere before the first npm publish, replace the \`file:../../..\` dependency with a reachable package source.

## Validation

- \`npm run check:playbook\` — archetype-specific validation path
- \`npm run check:publish\` — publish readiness gate
- \`npm run score:template\` — print a captured-run template for this archetype
- \`npm run check:bundle\` — verify this exported bundle still matches the package source
`);
}

function renderIdentity(spec: ArchetypeSpec): string {
  return normalizeText(`# Identity

Name: ${spec.displayName}
Emoji: ${spec.emoji}
Theme: ${spec.theme}

Operate as a SuperColony specialist. Prefer evidence-backed actions, keep wallet-backed writes deliberate, and use the exported skill files as the source of truth for this workspace.
`);
}

function renderOpenClawConfig(spec: ArchetypeSpec): string {
  return `${JSON.stringify({
    agents: {
      defaults: {
        skills: [spec.skillName],
      },
    },
    skills: {
      entries: {
        [spec.skillName]: {
          enabled: true,
        },
      },
    },
  }, null, 2)}\n`;
}

function renderBundlePackageJson(spec: ArchetypeSpec): string {
  return `${JSON.stringify({
    name: spec.bundlePackageName,
    private: true,
    type: "module",
    scripts: {
      "check:playbook": `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-playbook-path.ts --archetype ${spec.id}`,
      "check:publish": "node --import tsx ./node_modules/omniweb-toolkit/scripts/check-publish-readiness.ts",
      "check:attestation": "node --import tsx ./node_modules/omniweb-toolkit/scripts/check-attestation-workflow.ts",
      "score:template": spec.runTemplateScript,
      "check:bundle": `node --import tsx ../../../scripts/check-openclaw-export.ts --archetype ${spec.id}`,
    },
    dependencies: {
      "omniweb-toolkit": "file:../../..",
    },
    peerDependencies: {
      "@kynesyslabs/demosdk": ">=2.11.0",
      "better-sqlite3": "*",
    },
  }, null, 2)}\n`;
}

function renderSkill(spec: ArchetypeSpec): string {
  const metadata = JSON.stringify({
    openclaw: {
      emoji: spec.emoji,
      skillKey: spec.skillName,
      requires: {
        bins: ["node"],
      },
      homepage: "https://github.com/mj-deving/omniweb-agents/tree/main/packages/omniweb-toolkit",
    },
  });

  return normalizeText(`---
name: ${spec.skillName}
description: ${spec.summary}
metadata: ${metadata}
---

# ${spec.displayName}

Use this skill when the user wants an OpenClaw-style agent that follows the shipped \`${spec.id}\` playbook from \`omniweb-toolkit\`.

## First Read Order

1. Read \`{baseDir}/PLAYBOOK.md\` for the archetype's intent and action-selection rules.
2. Load \`{baseDir}/strategy.yaml\` as the concrete merged strategy baseline.
3. Open \`{baseDir}/RUNBOOK.md\` for the local validation path and workspace commands.
4. Use \`{baseDir}/starter.ts\` when you need the nearest code scaffold instead of improvising a loop from scratch.

## Default Workflow

1. Start read-first. Gather only the live state needed for the next decision.
2. Prefer the smallest action that advances the archetype's job.
3. Before any wallet-backed write, run the readiness checks listed in \`RUNBOOK.md\`.
4. If the current state does not justify a publish, skip the write and keep the evidence trail explicit.

## What To Preserve

- The playbook, not generic vibes, decides what counts as a good action.
- The merged \`strategy.yaml\` is the concrete baseline; do not silently invent thresholds.
- The starter scaffold is intentionally conservative. Extend it only after the packaged checks pass.
- When a publish depends on external evidence, treat \`check-attestation-workflow.ts\` as part of the loop rather than optional polish.

## Local Boundaries

- This skill assumes the workspace package has already installed \`omniweb-toolkit\` plus its required peers.
- Run commands from the workspace root unless \`RUNBOOK.md\` says otherwise.
- Use the exported files in this directory as the first source of truth, then fall back to the upstream package docs they reference.
`);
}

function renderRunbook(spec: ArchetypeSpec): string {
  const references = spec.references
    .map((path) => `- \`${path}\``)
    .join("\n");
  const observeFocus = spec.observeFocus
    .map((entry) => `- \`${entry}\``)
    .join("\n");
  const priorities = spec.actionPriorities
    .map((entry) => `- ${entry}`)
    .join("\n");

  return normalizeText(`# ${spec.displayName} Runbook

This file turns the exported skill into an operational OpenClaw workspace instead of a bare prompt.

## Validation Order

1. \`npm run check:playbook\`
2. \`npm run check:publish\`
3. \`npm run check:attestation -- --attest-url <primary-url> [--supporting-url <url> ...]\` when the claim depends on external evidence
4. \`${spec.runTemplateScript}\` when you want a captured-run template for deeper scoring or soak-testing

## Observe Focus

${observeFocus}

## Action Priorities

${priorities}

## Starter Scaffold

- File: \`starter.ts\`
- Main export: \`${spec.starterExportName}\`
- Goal: ${spec.starterGoal}
- Note: ${spec.starterCheckNote}

## Upstream References

${references}

## Packaged Eval Anchor

- Trajectory scenario: \`${spec.trajectoryScenario}\`
- Package shortcut: \`npm --prefix ../../../ run ${spec.playbookCheckScript}\`
`);
}

function renderLocalGuide(spec: ArchetypeSpec): string {
  const observeFocus = spec.observeFocus
    .map((entry) => `- \`${entry}\``)
    .join("\n");
  const priorities = spec.actionPriorities
    .map((entry) => `- ${entry}`)
    .join("\n");
  const localReferences = [
    "- [PLAYBOOK.md](./PLAYBOOK.md)",
    "- [strategy.yaml](./strategy.yaml)",
    "- [RUNBOOK.md](./RUNBOOK.md)",
    "- [starter.ts](./starter.ts)",
    "- [agent-loop-skeleton.ts](./agent-loop-skeleton.ts)",
    "- [example.trace.json](./example.trace.json)",
  ].concat(
    spec.references
      .filter((path) => path.startsWith("references/"))
      .map((path) => `- [references/${basename(path)}](./references/${basename(path)})`),
  ).join("\n");

  return normalizeText(`# ${spec.displayName} Local Guide

This bundle-local guide replaces the broader package GUIDE for OpenClaw workspace use.

## Method

1. Read the playbook before you act.
2. Treat \`strategy.yaml\` as the concrete baseline rather than inventing thresholds.
3. Use the starter scaffold when you need code and the runbook when you need commands.
4. Skip the write path when the observed state does not justify it.

## Observe Focus

${observeFocus}

## Action Priorities

${priorities}

## Local Files

${localReferences}
`);
}

function rewriteReferenceLinks(text: string): string {
  return normalizeText(text
    .replaceAll("../scripts/check-live-categories.ts", "../RUNBOOK.md")
    .replaceAll("../scripts/check-response-shapes.ts", "../RUNBOOK.md")
    .replaceAll("../scripts/leaderboard-snapshot.ts", "../RUNBOOK.md")
    .replaceAll("primitives/README.md", "../RUNBOOK.md"));
}

function readPackageFile(relativePath: string): string {
  return normalizeText(readFileSync(resolve(PACKAGE_ROOT, relativePath), "utf8"));
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
