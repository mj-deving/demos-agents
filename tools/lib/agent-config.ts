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
  };
  engagement: {
    minDisagreePerSession: number;
    replyMinParentReactions: number;
    maxReactionsPerSession: number;
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
  paths: AgentPaths;
}

export interface AgentPaths {
  personaMd: string;
  strategyYaml: string;
  agentYaml: string;
  sourcesRegistry: string;
  sessionDir: string;
  logFile: string;
  improvementsFile: string;
  findingsFile: string;
}

// ── Resolution ─────────────────────────────────────

const VALID_AGENT_NAME = /^[a-z0-9-]+$/;

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
  };
  engagement?: { minDisagreePerSession?: number; replyMinParentReactions?: number; maxReactionsPerSession?: number };
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

function validatePersonaConfig(yaml: any, filePath: string): ValidatedPersonaConfig {
  if (yaml === null || yaml === undefined || typeof yaml !== "object" || Array.isArray(yaml)) {
    throw new Error(`Invalid persona.yaml at ${filePath}: expected a plain object, got ${Array.isArray(yaml) ? "array" : typeof yaml}`);
  }

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

// ── Loader ─────────────────────────────────────────

/**
 * Load and validate agent config from agents/{name}/persona.yaml.
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
      gate: { predictedReactionsThreshold: 17, allow5Of6: true, duplicateWindowHours: 24 },
      calibration: { offset: 0 },
      paths,
    };
  }

  const raw = readFileSync(personaYamlPath, "utf-8");
  const yaml = validatePersonaConfig(parseYaml(raw), personaYamlPath);

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
    phaseBudgets: yaml.phaseBudgets,
    paths,
  };
}

/**
 * Get the repo root path (for tools that need it).
 */
export function getRepoRoot(): string {
  return REPO_ROOT;
}
