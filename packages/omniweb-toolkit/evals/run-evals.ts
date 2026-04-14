#!/usr/bin/env npx tsx
/**
 * run-evals.ts — On-demand eval runner for omniweb-toolkit skill quality.
 *
 * Validates evals.json assertions against SKILL.md content.
 * Does NOT execute live API calls or spend DEM — this is a static
 * consistency check that the eval descriptions match the actual API surface.
 *
 * For live trajectory evaluation, use promptfoo:
 *   npx promptfoo eval --config evals/trajectories.yaml
 *
 * Usage:
 *   npx tsx evals/run-evals.ts              # Run all evals
 *   npx tsx evals/run-evals.ts --id tip-*   # Run matching evals
 *   npx tsx evals/run-evals.ts --summary    # Counts only
 *   npx tsx evals/run-evals.ts --help       # Show help
 *
 * Output: JSON report to stdout. Errors to stderr.
 * Exit codes: 0 = all pass, 1 = failures found, 2 = invalid args
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface EvalCase {
  id: string;
  prompt: string;
  description: string;
  assertions: string[];
  input_files: string[];
}

interface EvalResult {
  id: string;
  status: "PASS" | "WARN" | "FAIL";
  checks: Array<{ check: string; passed: boolean; reason?: string }>;
}

// ── Help ────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx evals/run-evals.ts [--id PATTERN] [--summary]

Validates eval cases against SKILL.md API surface.

Options:
  --id PATTERN   Filter evals by id glob (e.g. --id "redteam-*")
  --summary      Print counts only, no details
  --help, -h     Show this help

Output: JSON report { total, passed, warned, failed, results[] }
Exit codes: 0 = all pass, 1 = failures, 2 = invalid args`);
  process.exit(0);
}

const summaryOnly = args.includes("--summary");
const idIdx = args.indexOf("--id");
const idFilter = idIdx >= 0 ? args[idIdx + 1] : null;

// ── Load evals and SKILL.md ─────────────────────
const evals: EvalCase[] = JSON.parse(
  readFileSync(join(__dirname, "evals.json"), "utf-8"),
);

const skillContent = readFileSync(
  join(__dirname, "..", "SKILL.md"), "utf-8",
);
const guideContent = readFileSync(
  join(__dirname, "..", "GUIDE.md"), "utf-8",
);

const packageRoot = join(__dirname, "..");
const openaiYamlPath = join(packageRoot, "agents", "openai.yaml");
const openaiYaml = existsSync(openaiYamlPath)
  ? readFileSync(openaiYamlPath, "utf-8")
  : "";
const routingCorpus = [skillContent, guideContent, openaiYaml].join("\n");

// Known valid API methods from SKILL.md
const KNOWN_METHODS = [
  "connect", "getFeed", "search", "getSignals", "getOracle", "getPrices",
  "getLeaderboard", "getAgents", "getPool", "getBalance", "getReactions",
  "getTipStats", "publish", "reply", "attest", "attestTlsn", "react",
  "tip", "placeBet", "placeHL", "register", "getMarkets", "getPredictions",
  "linkIdentity", "getForecastScore",
  // Identity domain
  "identity.link", "identity.lookup", "identity.getIdentities", "identity.createProof",
  // Escrow domain
  "escrow.sendToIdentity", "escrow.claimEscrow", "escrow.refundExpired",
  // Chain domain
  "chain.transfer", "chain.getBalance", "chain.signMessage",
  // IPFS domain
  "ipfs.upload", "ipfs.pin", "ipfs.unpin",
];

const KNOWN_NAMESPACED_METHODS = [
  "omni.colony.getFeed",
  "omni.colony.search",
  "omni.colony.getSignals",
  "omni.colony.getOracle",
  "omni.colony.getPrices",
  "omni.colony.getLeaderboard",
  "omni.colony.getAgents",
  "omni.colony.getPool",
  "omni.colony.getBalance",
  "omni.colony.getReactions",
  "omni.colony.getTipStats",
  "omni.colony.publish",
  "omni.colony.reply",
  "omni.colony.attest",
  "omni.colony.attestTlsn",
  "omni.colony.react",
  "omni.colony.tip",
  "omni.colony.placeBet",
  "omni.colony.placeHL",
  "omni.colony.register",
  "omni.colony.getMarkets",
  "omni.colony.getPredictions",
  "omni.colony.getForecastScore",
  "omni.identity.link",
  "omni.identity.lookup",
  "omni.identity.getIdentities",
  "omni.identity.createProof",
  "omni.escrow.sendToIdentity",
  "omni.escrow.claimEscrow",
  "omni.escrow.refundExpired",
  "omni.chain.transfer",
  "omni.chain.getBalance",
  "omni.chain.signMessage",
  "omni.ipfs.upload",
  "omni.ipfs.pin",
  "omni.ipfs.unpin",
];

// ── Validate each eval ──────────────────────────
function matchesFilter(id: string, pattern: string): boolean {
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
  return regex.test(id);
}

function validateEval(ev: EvalCase): EvalResult {
  const checks: EvalResult["checks"] = [];
  const isRoutingEval = ev.id.startsWith("routing-");

  // Check 1: ID is present and valid
  checks.push({
    check: "has valid id",
    passed: !!ev.id && /^[a-z0-9-]+$/.test(ev.id),
    reason: ev.id ? undefined : "missing id",
  });

  // Check 2: Description references known methods
  const methodsInDesc = KNOWN_METHODS.filter((m) =>
    ev.description.includes(m) || ev.description.includes(`omni.colony.${m}`) ||
    ev.description.includes(`omni.${m}`),
  );
  checks.push({
    check: isRoutingEval ? "description references routed companion files" : "description references valid methods",
    passed: isRoutingEval ? ev.input_files.length > 0 : methodsInDesc.length > 0,
    reason: isRoutingEval
      ? (ev.input_files.length > 0 ? undefined : "routing eval should declare input_files")
      : (methodsInDesc.length === 0 ? "no recognized API methods in description" : undefined),
  });

  // Check 3: Assertions are objective (not subjective)
  const subjectiveWords = ["good", "nice", "well", "properly", "correctly"];
  const hasSubjective = ev.assertions.some((a) =>
    subjectiveWords.some((w) => a.toLowerCase().includes(w)),
  );
  checks.push({
    check: "assertions are objective",
    passed: !hasSubjective,
    reason: hasSubjective ? "contains subjective assertion words" : undefined,
  });

  // Check 4: Methods in description + assertions exist in SKILL.md
  // Check both namespaced (omni.colony.getFeed) and bare (getFeed, placeHL) references
  const namespacedPattern = /omni\.(colony|identity|escrow|chain|ipfs|storage)\.\w+/g;
  const bareMethodPattern = /\b(getFeed|search|getSignals|getOracle|getPrices|getLeaderboard|getAgents|getPool|getBalance|getReactions|getTipStats|publish|reply|attest|attestTlsn|react|tip|placeBet|placeHL|register|getMarkets|getPredictions|linkIdentity|getForecastScore|connect)\b/g;
  const allText = ev.description + " " + ev.assertions.join(" ");
  const namespacedRefs = allText.match(namespacedPattern) ?? [];
  const bareRefs = allText.match(bareMethodPattern) ?? [];
  const allRefs = [...new Set([...namespacedRefs, ...bareRefs])];
  const unknownNamespaced = namespacedRefs.filter((m) => !KNOWN_NAMESPACED_METHODS.includes(m));
  const unknownBare = bareRefs.filter((m) => !KNOWN_METHODS.includes(m) && !KNOWN_METHODS.some((km) => km.endsWith(`.${m}`)));
  const unknownMethods = [...new Set([...unknownNamespaced, ...unknownBare])];
  checks.push({
    check: "all referenced methods exist in package API surface",
    passed: unknownMethods.length === 0,
    reason: unknownMethods.length > 0 ? `unknown: ${unknownMethods.join(", ")}` : undefined,
  });

  // Check 5: Assertions reference concrete verifiable tokens
  const guardrailTokens = ["INVALID_INPUT", "RATE_LIMITED", "DUPLICATE", "ATTEST_FAILED", "TX_FAILED",
    "10m", "30m", "4h", "24h", "1-10", "1000", "200"];
  const assertionText = ev.assertions.join(" ");
  const mentionsGuardrail = guardrailTokens.some((t) => assertionText.includes(t)) ||
    ev.assertions.some((a) => /\b(integer|clamped|blocked|rejected|error|fail)\b/i.test(a));
  // Only require guardrail tokens for redteam/guardrail evals (not edge — those test resilience)
  const needsGuardrailCheck = ev.id.startsWith("redteam-") || ev.id.startsWith("guardrail-");
  checks.push({
    check: needsGuardrailCheck ? "guardrail assertions reference concrete tokens" : "has sufficient assertions (≥2)",
    passed: needsGuardrailCheck ? mentionsGuardrail : ev.assertions.length >= 2,
    reason: needsGuardrailCheck && !mentionsGuardrail
      ? "guardrail eval lacks concrete error codes or constraint values"
      : ev.assertions.length < 2 ? `only ${ev.assertions.length} assertion(s)` : undefined,
  });

  // Check 6: input_files exist
  const missingInputFiles = ev.input_files.filter((relativePath) => !existsSync(join(packageRoot, relativePath)));
  checks.push({
    check: "input_files exist",
    passed: missingInputFiles.length === 0,
    reason: missingInputFiles.length > 0 ? `missing: ${missingInputFiles.join(", ")}` : undefined,
  });

  // Check 7: routed files are discoverable from the skill surface
  const undiscoverableInputs = ev.input_files.filter((relativePath) => !routingCorpus.includes(relativePath));
  checks.push({
    check: "input_files are discoverable from skill surface",
    passed: undiscoverableInputs.length === 0,
    reason: undiscoverableInputs.length > 0 ? `not routed: ${undiscoverableInputs.join(", ")}` : undefined,
  });

  const passCount = checks.filter((c) => c.passed).length;
  const status = passCount === checks.length ? "PASS"
    : passCount >= checks.length - 1 ? "WARN" : "FAIL";

  return { id: ev.id, status, checks };
}

function validateSkillArchitecture(): EvalResult {
  const checks: EvalResult["checks"] = [];

  checks.push({
    check: "SKILL.md routes to references",
    passed: /Load \[references\//.test(skillContent),
    reason: /Load \[references\//.test(skillContent) ? undefined : "missing explicit reference routing",
  });

  checks.push({
    check: "SKILL.md routes to scripts",
    passed: skillContent.includes("scripts/check-discovery-drift.ts") &&
      skillContent.includes("scripts/skill-self-audit.ts"),
    reason: skillContent.includes("scripts/check-discovery-drift.ts") &&
      skillContent.includes("scripts/skill-self-audit.ts")
      ? undefined
      : "missing explicit script routing",
  });

  checks.push({
    check: "GUIDE.md points to deeper references or assets",
    passed: guideContent.includes("references/interaction-patterns.md") &&
      guideContent.includes("assets/"),
    reason: guideContent.includes("references/interaction-patterns.md") &&
      guideContent.includes("assets/")
      ? undefined
      : "guide is not routing to deeper material",
  });

  checks.push({
    check: "agents/openai.yaml exists and mentions $omniweb-toolkit",
    passed: openaiYaml.length > 0 && openaiYaml.includes("$omniweb-toolkit"),
    reason: openaiYaml.length > 0 && openaiYaml.includes("$omniweb-toolkit")
      ? undefined
      : "missing or incomplete openai.yaml",
  });

  const passCount = checks.filter((check) => check.passed).length;
  const status = passCount === checks.length ? "PASS"
    : passCount >= checks.length - 1 ? "WARN" : "FAIL";

  return {
    id: "skill-architecture",
    status,
    checks,
  };
}

// ── Run ─────────────────────────────────────────
const filtered = idFilter
  ? evals.filter((e) => matchesFilter(e.id, idFilter))
  : evals;

if (filtered.length === 0) {
  console.error(`No evals matched filter: ${idFilter}`);
  process.exit(2);
}

const results = [...filtered.map(validateEval), validateSkillArchitecture()];
const passed = results.filter((r) => r.status === "PASS").length;
const warned = results.filter((r) => r.status === "WARN").length;
const failed = results.filter((r) => r.status === "FAIL").length;

const report = {
  total: results.length,
  passed,
  warned,
  failed,
  results: summaryOnly ? undefined : results,
};

console.log(JSON.stringify(report, null, 2));

process.exit(failed > 0 ? 1 : 0);
