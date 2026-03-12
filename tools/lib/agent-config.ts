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
  engagement: {
    minDisagreePerSession: number;
    replyMinParentReactions: number;
    maxReactionsPerSession: number;
  };
  gate: {
    predictedReactionsThreshold: number;
    allow5Of6: boolean;
  };
  calibration: { offset: number };
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
  engagement?: { minDisagreePerSession?: number; replyMinParentReactions?: number; maxReactionsPerSession?: number };
  gate?: { predictedReactionsThreshold?: number; allow5Of6?: boolean };
  calibration?: { offset?: number };
  [key: string]: unknown; // Allow extra fields from YAML
}

function validatePersonaConfig(yaml: any, filePath: string): ValidatedPersonaConfig {
  if (yaml === null || yaml === undefined || typeof yaml !== "object") {
    throw new Error(`Invalid persona.yaml at ${filePath}: expected an object, got ${typeof yaml}`);
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
    if (typeof yaml.topics !== "object" || yaml.topics === null) {
      errors.push(`topics: expected object, got ${typeof yaml.topics}`);
    } else {
      if (yaml.topics.primary !== undefined && !Array.isArray(yaml.topics.primary)) {
        errors.push(`topics.primary: expected array, got ${typeof yaml.topics.primary}`);
      }
      if (yaml.topics.secondary !== undefined && !Array.isArray(yaml.topics.secondary)) {
        errors.push(`topics.secondary: expected array, got ${typeof yaml.topics.secondary}`);
      }
    }
  }
  if (yaml.engagement !== undefined && (typeof yaml.engagement !== "object" || yaml.engagement === null)) {
    errors.push(`engagement: expected object, got ${typeof yaml.engagement}`);
  }
  if (yaml.gate !== undefined && (typeof yaml.gate !== "object" || yaml.gate === null)) {
    errors.push(`gate: expected object, got ${typeof yaml.gate}`);
  }
  if (yaml.calibration !== undefined && (typeof yaml.calibration !== "object" || yaml.calibration === null)) {
    errors.push(`calibration: expected object, got ${typeof yaml.calibration}`);
  }

  // Numeric field checks
  const numericChecks = [
    ["engagement.minDisagreePerSession", yaml.engagement?.minDisagreePerSession],
    ["engagement.replyMinParentReactions", yaml.engagement?.replyMinParentReactions],
    ["engagement.maxReactionsPerSession", yaml.engagement?.maxReactionsPerSession],
    ["gate.predictedReactionsThreshold", yaml.gate?.predictedReactionsThreshold],
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
      engagement: {
        minDisagreePerSession: 1,
        replyMinParentReactions: 8,
        maxReactionsPerSession: 8,
      },
      gate: { predictedReactionsThreshold: 17, allow5Of6: true },
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
    engagement: {
      minDisagreePerSession: yaml.engagement?.minDisagreePerSession ?? 1,
      replyMinParentReactions: yaml.engagement?.replyMinParentReactions ?? 8,
      maxReactionsPerSession: yaml.engagement?.maxReactionsPerSession ?? 8,
    },
    gate: {
      predictedReactionsThreshold: yaml.gate?.predictedReactionsThreshold ?? 17,
      allow5Of6: yaml.gate?.allow5Of6 ?? true,
    },
    calibration: { offset: yaml.calibration?.offset ?? 0 },
    paths,
  };
}

/**
 * Get the repo root path (for tools that need it).
 */
export function getRepoRoot(): string {
  return REPO_ROOT;
}
