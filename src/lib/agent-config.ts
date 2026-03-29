/**
 * Agent configuration loader — central config for multi-agent support.
 *
 * Loads agent identity, engagement rules, gate thresholds, and path config
 * from agents/{name}/persona.yaml. All helper functions accept config slices
 * instead of reading module-level constants.
 *
 * Resolution: --agent flag → AGENT_NAME env → "sentinel"
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

// ── Constants ──────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ── Types ──────────────────────────────────────────

export interface AgentConfig {
  name: string;
  displayName: string;
  topics: { primary: string[]; secondary: string[] };
  scan: {
    modes: string[];
    qualityFloor: number;
    requireAttestation: boolean;
    depth: number;
    topicSearchLimit: number;
    cacheHours: number;
  };
  attestation: {
    defaultMode: "dahr_only" | "tlsn_preferred" | "tlsn_only";
    highSensitivityRequireTlsn: boolean;
    highSensitivityKeywords: string[];
    budget?: {
      maxCostPerPost?: number;
      maxTlsnPerPost?: number;
      maxDahrPerPost?: number;
      maxAttestationsPerPost?: number;
    };
  };
  engagement: {
    minDisagreePerSession: number;
    replyMinParentReactions: number;
    maxReactionsPerSession: number;
  };
  tipping: {
    enabled: boolean;
    maxTipsPerSession: number;
    maxPerRecipientPerDay: number;
    minMinutesBetweenTips: number;
    minSessionsBeforeLive: number;
    minScore: number;
    requireAttestation: boolean;
  };
  gate: {
    predictedReactionsThreshold: number;
    allow5Of6: boolean;
    duplicateWindowHours: number;
    mode?: "standard" | "pioneer";
    signalStrengthThreshold?: number;
    noveltyCheck?: boolean;
    noveltyMentionThreshold?: number;
  };
  calibration: { offset: number };
  phaseBudgets?: Partial<Record<string, number>>;
  loopExtensions: string[];
  sourceRegistryMode: "catalog-preferred" | "catalog-only" | "yaml-only";
  paths: AgentPaths;
}

export interface AgentPaths {
  personaMd: string;
  strategyYaml: string;
  agentYaml: string;
  sourcesRegistry: string;
  sourceCatalog: string;
  sourceConfig: string;
  sessionDir: string;
  logFile: string;
  improvementsFile: string;
  findingsFile: string;
}

// ── Resolution ─────────────────────────────────────

const VALID_AGENT_NAME = /^[a-z0-9-]+$/;
// Import canonical extension list from state.ts to avoid duplication
import { KNOWN_EXTENSIONS } from "./state.js";
const KNOWN_LOOP_EXTENSIONS = new Set<string>(KNOWN_EXTENSIONS);

/**
 * Resolve agent name from CLI flags, env, or default.
 * Priority: --agent flag → AGENT_NAME env → "sentinel"
 * Validates against strict pattern to prevent path traversal.
 */
export function resolveAgentName(flags?: Record<string, string>): string {
  const name = flags?.["agent"] || process.env.AGENT_NAME || "sentinel";
  if (!VALID_AGENT_NAME.test(name)) {
    throw new Error(`Invalid agent name "${name}" — must match ${VALID_AGENT_NAME}`);
  }
  return name;
}

// ── Path Resolution ────────────────────────────────

/**
 * Build all filesystem paths for an agent.
 * Uses ~/.{name}/ convention for state directories.
 */
function buildPaths(name: string): AgentPaths {
  const home = homedir();
  const agentDir = resolve(REPO_ROOT, "agents", name);

  return {
    personaMd: resolve(agentDir, "persona.md"),
    strategyYaml: resolve(agentDir, "strategy.yaml"),
    agentYaml: resolve(agentDir, "AGENT.yaml"),
    sourcesRegistry: resolve(agentDir, "sources-registry.yaml"),
    sourceCatalog: resolve(REPO_ROOT, "config", "sources", "catalog.json"),
    sourceConfig: resolve(agentDir, "source-config.yaml"),
    sessionDir: resolve(home, `.${name}`, "sessions"),
    logFile: resolve(home, `.${name}-session-log.jsonl`),
    improvementsFile: resolve(home, `.${name}-improvements.json`),
    findingsFile: resolve(home, `.${name}-review-findings.json`),
  };
}

// ── Validation ──────────────────────────────────────

/**
 * Validate persona.yaml parsed object. Throws on type violations,
 * returns validated config with defaults applied for missing fields.
 * Permissive on extra fields — only validates fields we consume.
 */
interface ValidatedPersonaConfig {
  name?: string;
  displayName?: string;
  topics?: { primary?: string[]; secondary?: string[] };
  scan?: {
    modes?: string[];
    qualityFloor?: number;
    requireAttestation?: boolean;
    depth?: number;
    topicSearchLimit?: number;
    cacheHours?: number;
  };
  attestation?: {
    defaultMode?: "dahr_only" | "tlsn_preferred" | "tlsn_only";
    highSensitivityRequireTlsn?: boolean;
    highSensitivityKeywords?: string[];
    budget?: {
      maxCostPerPost?: number;
      maxTlsnPerPost?: number;
      maxDahrPerPost?: number;
      maxAttestationsPerPost?: number;
    };
  };
  engagement?: { minDisagreePerSession?: number; replyMinParentReactions?: number; maxReactionsPerSession?: number };
  tipping?: {
    enabled?: boolean;
    maxTipsPerSession?: number;
    maxPerRecipientPerDay?: number;
    minMinutesBetweenTips?: number;
    minSessionsBeforeLive?: number;
    minScore?: number;
    requireAttestation?: boolean;
  };
  gate?: {
    predictedReactionsThreshold?: number;
    allow5Of6?: boolean;
    duplicateWindowHours?: number;
    mode?: "standard" | "pioneer";
    signalStrengthThreshold?: number;
    noveltyCheck?: boolean;
    noveltyMentionThreshold?: number;
  };
  calibration?: { offset?: number };
  [key: string]: unknown; // Allow extra fields from YAML
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePersonaConfig(rawYaml: unknown, filePath: string): ValidatedPersonaConfig {
  if (!isPlainObject(rawYaml)) {
    throw new Error(`Invalid persona.yaml at ${filePath}: expected a plain object, got ${Array.isArray(rawYaml) ? "array" : typeof rawYaml}`);
  }
  const yaml = rawYaml as ValidatedPersonaConfig;

  const errors: string[] = [];

  // Type checks for fields that would cause runtime issues if wrong type
  if (yaml.name !== undefined && typeof yaml.name !== "string") {
    errors.push(`name: expected string, got ${typeof yaml.name}`);
  }
  if (yaml.displayName !== undefined && typeof yaml.displayName !== "string") {
    errors.push(`displayName: expected string, got ${typeof yaml.displayName}`);
  }
  if (yaml.topics !== undefined) {
    if (typeof yaml.topics !== "object" || yaml.topics === null || Array.isArray(yaml.topics)) {
      errors.push(`topics: expected object, got ${Array.isArray(yaml.topics) ? "array" : typeof yaml.topics}`);
    } else {
      if (yaml.topics.primary !== undefined) {
        if (!Array.isArray(yaml.topics.primary)) {
          errors.push(`topics.primary: expected string array, got ${typeof yaml.topics.primary}`);
        } else if (yaml.topics.primary.some((v: unknown) => typeof v !== "string")) {
          errors.push(`topics.primary: all elements must be strings`);
        }
      }
      if (yaml.topics.secondary !== undefined) {
        if (!Array.isArray(yaml.topics.secondary)) {
          errors.push(`topics.secondary: expected string array, got ${typeof yaml.topics.secondary}`);
        } else if (yaml.topics.secondary.some((v: unknown) => typeof v !== "string")) {
          errors.push(`topics.secondary: all elements must be strings`);
        }
      }
    }
  }
  if (yaml.engagement !== undefined && (typeof yaml.engagement !== "object" || yaml.engagement === null || Array.isArray(yaml.engagement))) {
    errors.push(`engagement: expected object, got ${Array.isArray(yaml.engagement) ? "array" : typeof yaml.engagement}`);
  }
  if (yaml.tipping !== undefined && (typeof yaml.tipping !== "object" || yaml.tipping === null || Array.isArray(yaml.tipping))) {
    errors.push(`tipping: expected object, got ${Array.isArray(yaml.tipping) ? "array" : typeof yaml.tipping}`);
  }
  if (yaml.scan !== undefined && (typeof yaml.scan !== "object" || yaml.scan === null || Array.isArray(yaml.scan))) {
    errors.push(`scan: expected object, got ${Array.isArray(yaml.scan) ? "array" : typeof yaml.scan}`);
  }
  if (yaml.attestation !== undefined && (typeof yaml.attestation !== "object" || yaml.attestation === null || Array.isArray(yaml.attestation))) {
    errors.push(`attestation: expected object, got ${Array.isArray(yaml.attestation) ? "array" : typeof yaml.attestation}`);
  }
  if (yaml.gate !== undefined && (typeof yaml.gate !== "object" || yaml.gate === null || Array.isArray(yaml.gate))) {
    errors.push(`gate: expected object, got ${Array.isArray(yaml.gate) ? "array" : typeof yaml.gate}`);
  }
  if (yaml.calibration !== undefined && (typeof yaml.calibration !== "object" || yaml.calibration === null || Array.isArray(yaml.calibration))) {
    errors.push(`calibration: expected object, got ${Array.isArray(yaml.calibration) ? "array" : typeof yaml.calibration}`);
  }

  // Numeric field checks
  const numericChecks = [
    ["engagement.minDisagreePerSession", yaml.engagement?.minDisagreePerSession],
    ["engagement.replyMinParentReactions", yaml.engagement?.replyMinParentReactions],
    ["engagement.maxReactionsPerSession", yaml.engagement?.maxReactionsPerSession],
    ["tipping.maxTipsPerSession", yaml.tipping?.maxTipsPerSession],
    ["tipping.maxPerRecipientPerDay", yaml.tipping?.maxPerRecipientPerDay],
    ["tipping.minMinutesBetweenTips", yaml.tipping?.minMinutesBetweenTips],
    ["tipping.minSessionsBeforeLive", yaml.tipping?.minSessionsBeforeLive],
    ["tipping.minScore", yaml.tipping?.minScore],
    ["scan.qualityFloor", yaml.scan?.qualityFloor],
    ["scan.depth", yaml.scan?.depth],
    ["scan.topicSearchLimit", yaml.scan?.topicSearchLimit],
    ["scan.cacheHours", yaml.scan?.cacheHours],
    ["gate.predictedReactionsThreshold", yaml.gate?.predictedReactionsThreshold],
    ["gate.duplicateWindowHours", yaml.gate?.duplicateWindowHours],
    ["gate.signalStrengthThreshold", yaml.gate?.signalStrengthThreshold],
    ["gate.noveltyMentionThreshold", yaml.gate?.noveltyMentionThreshold],
    ["calibration.offset", yaml.calibration?.offset],
  ] as const;
  for (const [field, val] of numericChecks) {
    if (val !== undefined && typeof val !== "number") {
      errors.push(`${field}: expected number, got ${typeof val}`);
    }
  }

  if (yaml.gate?.allow5Of6 !== undefined && typeof yaml.gate.allow5Of6 !== "boolean") {
    errors.push(`gate.allow5Of6: expected boolean, got ${typeof yaml.gate.allow5Of6}`);
  }
  if (yaml.tipping?.enabled !== undefined && typeof yaml.tipping.enabled !== "boolean") {
    errors.push(`tipping.enabled: expected boolean, got ${typeof yaml.tipping.enabled}`);
  }
  if (yaml.tipping?.requireAttestation !== undefined && typeof yaml.tipping.requireAttestation !== "boolean") {
    errors.push(`tipping.requireAttestation: expected boolean, got ${typeof yaml.tipping.requireAttestation}`);
  }
  if (yaml.scan?.requireAttestation !== undefined && typeof yaml.scan.requireAttestation !== "boolean") {
    errors.push(`scan.requireAttestation: expected boolean, got ${typeof yaml.scan.requireAttestation}`);
  }
  if (yaml.scan?.modes !== undefined) {
    if (!Array.isArray(yaml.scan.modes)) {
      errors.push(`scan.modes: expected string array, got ${typeof yaml.scan.modes}`);
    } else if (yaml.scan.modes.some((v: unknown) => typeof v !== "string")) {
      errors.push(`scan.modes: all elements must be strings`);
    }
  }
  if (yaml.scan?.qualityFloor !== undefined) {
    const floor = yaml.scan.qualityFloor;
    if (!Number.isFinite(floor) || floor < 0 || floor > 100) {
      errors.push(`scan.qualityFloor: expected number in range [0, 100], got ${floor}`);
    }
  }
  if (yaml.scan?.depth !== undefined) {
    const depth = yaml.scan.depth;
    if (!Number.isFinite(depth) || depth < 1 || depth > 200) {
      errors.push(`scan.depth: expected number in range [1, 200], got ${depth}`);
    }
  }
  if (yaml.scan?.topicSearchLimit !== undefined) {
    const limit = yaml.scan.topicSearchLimit;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      errors.push(`scan.topicSearchLimit: expected number in range [1, 100], got ${limit}`);
    }
  }
  if (yaml.scan?.cacheHours !== undefined) {
    const hours = yaml.scan.cacheHours;
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      errors.push(`scan.cacheHours: expected number in range [1, 168], got ${hours}`);
    }
  }
  if (yaml.tipping?.maxTipsPerSession !== undefined) {
    const maxTips = yaml.tipping.maxTipsPerSession;
    if (!Number.isFinite(maxTips) || maxTips < 1 || maxTips > 2) {
      errors.push(`tipping.maxTipsPerSession: expected number in range [1, 2], got ${maxTips}`);
    }
  }
  if (yaml.tipping?.maxPerRecipientPerDay !== undefined) {
    const maxPerRecipient = yaml.tipping.maxPerRecipientPerDay;
    if (!Number.isFinite(maxPerRecipient) || maxPerRecipient < 1 || maxPerRecipient > 10) {
      errors.push(`tipping.maxPerRecipientPerDay: expected number in range [1, 10], got ${maxPerRecipient}`);
    }
  }
  if (yaml.tipping?.minMinutesBetweenTips !== undefined) {
    const minutes = yaml.tipping.minMinutesBetweenTips;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      errors.push(`tipping.minMinutesBetweenTips: expected number in range [1, 1440], got ${minutes}`);
    }
  }
  if (yaml.tipping?.minSessionsBeforeLive !== undefined) {
    const sessions = yaml.tipping.minSessionsBeforeLive;
    if (!Number.isFinite(sessions) || sessions < 0 || sessions > 1000) {
      errors.push(`tipping.minSessionsBeforeLive: expected number in range [0, 1000], got ${sessions}`);
    }
  }
  if (yaml.tipping?.minScore !== undefined) {
    const minScore = yaml.tipping.minScore;
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      errors.push(`tipping.minScore: expected number in range [0, 100], got ${minScore}`);
    }
  }
  if (yaml.attestation?.defaultMode !== undefined) {
    if (typeof yaml.attestation.defaultMode !== "string") {
      errors.push(`attestation.defaultMode: expected string, got ${typeof yaml.attestation.defaultMode}`);
    } else if (!["dahr_only", "tlsn_preferred", "tlsn_only"].includes(yaml.attestation.defaultMode)) {
      errors.push(`attestation.defaultMode: expected "dahr_only", "tlsn_preferred", or "tlsn_only", got "${yaml.attestation.defaultMode}"`);
    }
  }
  if (yaml.attestation?.highSensitivityRequireTlsn !== undefined && typeof yaml.attestation.highSensitivityRequireTlsn !== "boolean") {
    errors.push(`attestation.highSensitivityRequireTlsn: expected boolean, got ${typeof yaml.attestation.highSensitivityRequireTlsn}`);
  }
  if (yaml.attestation?.highSensitivityKeywords !== undefined) {
    if (!Array.isArray(yaml.attestation.highSensitivityKeywords)) {
      errors.push(`attestation.highSensitivityKeywords: expected string array, got ${typeof yaml.attestation.highSensitivityKeywords}`);
    } else if (yaml.attestation.highSensitivityKeywords.some((v: unknown) => typeof v !== "string")) {
      errors.push(`attestation.highSensitivityKeywords: all elements must be strings`);
    }
  }
  if (yaml.gate?.duplicateWindowHours !== undefined) {
    const hours = yaml.gate.duplicateWindowHours;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 720) {
      errors.push(`gate.duplicateWindowHours: expected number in range (0, 720], got ${hours}`);
    }
  }
  if (yaml.gate?.mode !== undefined) {
    if (typeof yaml.gate.mode !== "string") {
      errors.push(`gate.mode: expected string, got ${typeof yaml.gate.mode}`);
    } else if (yaml.gate.mode !== "standard" && yaml.gate.mode !== "pioneer") {
      errors.push(`gate.mode: expected "standard" or "pioneer", got "${yaml.gate.mode}"`);
    }
  }
  if (yaml.gate?.signalStrengthThreshold !== undefined) {
    const threshold = yaml.gate.signalStrengthThreshold;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      errors.push(`gate.signalStrengthThreshold: expected number in range [0, 100], got ${threshold}`);
    }
  }
  if (yaml.gate?.noveltyCheck !== undefined && typeof yaml.gate.noveltyCheck !== "boolean") {
    errors.push(`gate.noveltyCheck: expected boolean, got ${typeof yaml.gate.noveltyCheck}`);
  }
  if (yaml.gate?.noveltyMentionThreshold !== undefined) {
    const threshold = yaml.gate.noveltyMentionThreshold;
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 50) {
      errors.push(`gate.noveltyMentionThreshold: expected number in range [1, 50], got ${threshold}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid persona.yaml at ${filePath}:\n  - ${errors.join("\n  - ")}`);
  }

  return yaml;
}

// ── Loop Extension Validation ─────────────────────

function parseLoopExtensions(yaml: unknown, filePath: string): string[] {
  const root = isPlainObject(yaml) ? yaml : null;
  const loop = isPlainObject(root?.loop) ? root.loop : null;
  const raw = loop?.extensions;
  if (!raw) return [];
  if (!Array.isArray(raw)) {
    console.warn(`Warning: loop.extensions in ${filePath} is not an array — ignored`);
    return [];
  }
  const validated: string[] = [];
  for (const ext of raw) {
    const name = String(ext || "").trim();
    if (!name) continue;
    if (!KNOWN_LOOP_EXTENSIONS.has(name)) {
      console.warn(`Warning: unknown loop extension "${name}" in ${filePath} — ignored`);
      continue;
    }
    validated.push(name);
  }
  return validated;
}

// ── Deep Merge ──────────────────────────────────────

/**
 * Deep merge two plain objects. Agent values override base values.
 * Arrays are replaced (not concatenated) — agent's array wins entirely.
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];
    if (
      isPlainObject(overVal) &&
      isPlainObject(baseVal)
    ) {
      result[key] = deepMerge(baseVal, overVal);
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

/**
 * Load persona-base.yaml shared defaults. Returns empty object if not found.
 */
function loadBasePersona(): Record<string, unknown> {
  const basePath = resolve(REPO_ROOT, "agents", "persona-base.yaml");
  if (!existsSync(basePath)) return {};
  try {
    const parsed = parseYaml(readFileSync(basePath, "utf-8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ── Loader ─────────────────────────────────────────

/**
 * Load and validate agent config from agents/{name}/persona.yaml.
 * Deep-merges agents/persona-base.yaml defaults with agent-specific overrides.
 * Falls back to sensible defaults if persona.yaml is missing (for bootstrapping).
 */
export function loadAgentConfig(name?: string): AgentConfig {
  const agentName = name || "sentinel";
  const paths = buildPaths(agentName);
  const personaYamlPath = resolve(REPO_ROOT, "agents", agentName, "persona.yaml");

  if (!existsSync(personaYamlPath)) {
    // Return defaults — allows tools to work before persona.yaml exists
    return {
      name: agentName,
      displayName: agentName.charAt(0).toUpperCase() + agentName.slice(1),
      topics: { primary: [], secondary: [] },
      scan: {
        modes: ["lightweight"],
        qualityFloor: 70,
        requireAttestation: false,
        depth: 200,
        topicSearchLimit: 30,
        cacheHours: 4,
      },
      attestation: {
        defaultMode: "dahr_only",
        highSensitivityRequireTlsn: true,
        highSensitivityKeywords: [],
      },
      engagement: {
        minDisagreePerSession: 1,
        replyMinParentReactions: 8,
        maxReactionsPerSession: 8,
      },
      tipping: {
        enabled: false,
        maxTipsPerSession: 2,
        maxPerRecipientPerDay: 2,
        minMinutesBetweenTips: 5,
        minSessionsBeforeLive: 3,
        minScore: 80,
        requireAttestation: true,
      },
      gate: { predictedReactionsThreshold: 17, allow5Of6: true, duplicateWindowHours: 24 },
      calibration: { offset: 0 },
      loopExtensions: [],
      sourceRegistryMode: "catalog-preferred",
      paths,
    };
  }

  const base = loadBasePersona();
  const agentRaw = parseYaml(readFileSync(personaYamlPath, "utf-8")) ?? {};
  const merged = Object.keys(base).length > 0 ? deepMerge(base, agentRaw) : agentRaw;
  const yaml = validatePersonaConfig(merged, personaYamlPath);

  return {
    name: yaml.name || agentName,
    displayName: yaml.displayName || agentName,
    topics: {
      primary: yaml.topics?.primary || [],
      secondary: yaml.topics?.secondary || [],
    },
    scan: {
      modes: yaml.scan?.modes ?? ["lightweight"],
      qualityFloor: yaml.scan?.qualityFloor ?? 70,
      requireAttestation: yaml.scan?.requireAttestation ?? false,
      depth: yaml.scan?.depth ?? 200,
      topicSearchLimit: yaml.scan?.topicSearchLimit ?? 30,
      cacheHours: yaml.scan?.cacheHours ?? 4,
    },
    attestation: {
      defaultMode: yaml.attestation?.defaultMode ?? "dahr_only",
      highSensitivityRequireTlsn: yaml.attestation?.highSensitivityRequireTlsn ?? true,
      highSensitivityKeywords: yaml.attestation?.highSensitivityKeywords ?? [],
    },
    engagement: {
      minDisagreePerSession: yaml.engagement?.minDisagreePerSession ?? 1,
      replyMinParentReactions: yaml.engagement?.replyMinParentReactions ?? 8,
      maxReactionsPerSession: yaml.engagement?.maxReactionsPerSession ?? 8,
    },
    tipping: {
      enabled: yaml.tipping?.enabled ?? false,
      maxTipsPerSession: yaml.tipping?.maxTipsPerSession ?? 2,
      maxPerRecipientPerDay: yaml.tipping?.maxPerRecipientPerDay ?? 2,
      minMinutesBetweenTips: yaml.tipping?.minMinutesBetweenTips ?? 5,
      minSessionsBeforeLive: yaml.tipping?.minSessionsBeforeLive ?? 3,
      minScore: yaml.tipping?.minScore ?? 80,
      requireAttestation: yaml.tipping?.requireAttestation ?? true,
    },
    gate: {
      predictedReactionsThreshold: yaml.gate?.predictedReactionsThreshold ?? 17,
      allow5Of6: yaml.gate?.allow5Of6 ?? true,
      duplicateWindowHours: yaml.gate?.duplicateWindowHours ?? 24,
      mode: yaml.gate?.mode,
      signalStrengthThreshold: yaml.gate?.signalStrengthThreshold,
      noveltyCheck: yaml.gate?.noveltyCheck,
      noveltyMentionThreshold: yaml.gate?.noveltyMentionThreshold,
    },
    calibration: { offset: yaml.calibration?.offset ?? 0 },
    phaseBudgets: yaml.phaseBudgets as Partial<Record<string, number>> | undefined,
    loopExtensions: parseLoopExtensions(yaml, personaYamlPath),
    sourceRegistryMode: ((): AgentConfig["sourceRegistryMode"] => {
      const mode = (yaml as Record<string, unknown>).sourceRegistryMode as string | undefined;
      if (mode === "catalog-only" || mode === "yaml-only") return mode;
      if (mode && mode !== "catalog-preferred") {
        console.warn(`[agent-config] Unknown sourceRegistryMode "${mode}" in ${personaYamlPath}, defaulting to catalog-preferred`);
      }
      return "catalog-preferred";
    })(),
    paths,
  };
}

/**
 * Get the repo root path (for tools that need it).
 */
export function getRepoRoot(): string {
  return REPO_ROOT;
}
