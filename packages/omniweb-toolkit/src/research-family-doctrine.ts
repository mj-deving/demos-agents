import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ResearchTopicFamily } from "./research-source-profile.js";

export interface ResearchFamilyDossier {
  family: ResearchTopicFamily;
  baseline: string[];
  focus: string[];
  falseInferenceGuards: string[];
}

interface ResearchFamilyDoctrineFile {
  family: Exclude<ResearchTopicFamily, "unsupported">;
  displayName?: string;
  baseline: string[];
  focus: string[];
  blocked: string[];
}

type SupportedResearchTopicFamily = Exclude<ResearchTopicFamily, "unsupported">;
type ResearchFamilyDoctrineRegistry = Record<SupportedResearchTopicFamily, ResearchFamilyDossier>;

const SUPPORTED_RESEARCH_FAMILIES: SupportedResearchTopicFamily[] = [
  "stablecoin-supply",
  "funding-structure",
  "spot-momentum",
  "etf-flows",
  "network-activity",
  "vix-credit",
];

const GENERIC_DOSSIER: ResearchFamilyDossier = {
  family: "unsupported",
  baseline: [
    "Use the fetched evidence as the center of gravity for the post.",
  ],
  focus: [
    "Explain what changed or what is mismatched in the evidence.",
  ],
  falseInferenceGuards: [
    "Do not turn internal workflow or default invariants into the thesis.",
  ],
};

let cachedRegistry: ResearchFamilyDoctrineRegistry | null = null;

export function dossierForFamily(family: ResearchTopicFamily): ResearchFamilyDossier {
  if (family === "unsupported") {
    return GENERIC_DOSSIER;
  }

  const registry = loadResearchFamilyDoctrineRegistry();
  return registry[family] ?? {
    ...GENERIC_DOSSIER,
    family,
  };
}

export function loadResearchFamilyDoctrineRegistry(explicitDir?: string): ResearchFamilyDoctrineRegistry {
  if (explicitDir == null && cachedRegistry != null) {
    return cachedRegistry;
  }

  const doctrineDir = resolveDoctrineDir(explicitDir);
  const registry = Object.create(null) as ResearchFamilyDoctrineRegistry;

  for (const family of SUPPORTED_RESEARCH_FAMILIES) {
    const path = `${doctrineDir}/${family}.yaml`;
    if (!existsSync(path)) {
      throw new Error(`missing_research_family_doctrine:${family}`);
    }

    const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
    registry[family] = toResearchFamilyDossier(parsed, family);
  }

  if (explicitDir == null) {
    cachedRegistry = registry;
  }

  return registry;
}

function resolveDoctrineDir(explicitDir?: string): string {
  const candidates = [
    explicitDir,
    process.env.OMNIWEB_DOCTRINE_DIR,
    fileURLToPath(new URL("../config/doctrine", import.meta.url)),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("missing_research_family_doctrine_dir");
}

function toResearchFamilyDossier(
  value: unknown,
  expectedFamily: SupportedResearchTopicFamily,
): ResearchFamilyDossier {
  const parsed = value as Partial<ResearchFamilyDoctrineFile> | null;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`invalid_research_family_doctrine:${expectedFamily}`);
  }

  if (parsed.family !== expectedFamily) {
    throw new Error(`mismatched_research_family_doctrine:${expectedFamily}`);
  }

  const baseline = readStringArray(parsed.baseline, `${expectedFamily}.baseline`);
  const focus = readStringArray(parsed.focus, `${expectedFamily}.focus`);
  const blocked = readStringArray(parsed.blocked, `${expectedFamily}.blocked`);

  return {
    family: expectedFamily,
    baseline,
    focus,
    falseInferenceGuards: blocked,
  };
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`invalid_research_family_doctrine_field:${field}`);
  }

  return value;
}

export function clearResearchFamilyDoctrineCacheForTests(): void {
  cachedRegistry = null;
}
