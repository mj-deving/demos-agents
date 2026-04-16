#!/usr/bin/env npx tsx

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import { getStringArg, hasFlag } from "../scripts/_shared.js";

type Archetype = "research-agent" | "market-analyst" | "engagement-optimizer";
type CaptureSource = "live" | "captured" | "example";
type ActionType = "publish" | "bet" | "tip" | "react" | "reply" | "skip";
type OpportunityStrength = "high" | "medium" | "low";

interface PlaybookRunCapture {
  meta?: {
    runId?: string;
    archetype?: Archetype;
    source?: CaptureSource;
    capturedAt?: string;
    notes?: string;
  };
  context?: {
    balanceDem?: number;
    dailyCapDem?: number;
    spentTodayDem?: number;
    publishWindowOpen?: boolean;
    marketSurfaceConfirmed?: boolean;
    notes?: string;
  };
  opportunities?: Opportunity[];
  decision?: {
    primaryAction?: ActionType;
    consideredActions?: ActionType[];
    skippedActions?: ActionType[];
    reasoning?: string;
  };
  actions?: Action[];
  notes?: string;
}

interface Opportunity {
  id?: string;
  kind?: string;
  summary?: string;
  strength?: OpportunityStrength;
  recommendedAction?: ActionType;
  preferredCategory?: string;
  publishReady?: boolean;
  evidence?: string[];
}

interface Action {
  type?: ActionType;
  status?: "executed" | "skipped" | "planned";
  category?: string;
  text?: string;
  attestUrl?: string;
  confidence?: number;
  evidenceRefs?: string[];
  costDem?: number;
  amountDem?: number;
  horizon?: string;
  direction?: string;
  skipReason?: string;
}

interface ValidationIssue {
  path: string;
  message: string;
}

interface DimensionCheck {
  name: string;
  pass: boolean;
  detail: string;
}

interface DimensionResult {
  dimension: string;
  score: number;
  weight: number;
  weightedContribution: number;
  checks: DimensionCheck[];
}

interface Rubric {
  allowedCategories: string[];
  defaultPublishCategory: string;
  minTextLength: number;
  confidenceRange: { min: number; max: number };
  weights: Record<string, number>;
}

const SUPPORTED_ARCHETYPES: Archetype[] = [
  "research-agent",
  "market-analyst",
  "engagement-optimizer",
];

const RUBRICS: Record<Archetype, Rubric> = {
  "research-agent": {
    allowedCategories: ["ANALYSIS", "OBSERVATION"],
    defaultPublishCategory: "ANALYSIS",
    minTextLength: 300,
    confidenceRange: { min: 55, max: 90 },
    weights: {
      bestActionChoice: 25,
      skipDiscipline: 15,
      evidenceUse: 20,
      categoryChoice: 10,
      budgetDiscipline: 10,
      publishQuality: 20,
    },
  },
  "market-analyst": {
    allowedCategories: ["ANALYSIS", "PREDICTION", "SIGNAL"],
    defaultPublishCategory: "ANALYSIS",
    minTextLength: 200,
    confidenceRange: { min: 50, max: 90 },
    weights: {
      bestActionChoice: 25,
      skipDiscipline: 15,
      evidenceUse: 15,
      categoryChoice: 10,
      budgetDiscipline: 20,
      publishQuality: 15,
    },
  },
  "engagement-optimizer": {
    allowedCategories: ["ANALYSIS", "OBSERVATION", "FEED"],
    defaultPublishCategory: "OBSERVATION",
    minTextLength: 180,
    confidenceRange: { min: 45, max: 85 },
    weights: {
      bestActionChoice: 20,
      skipDiscipline: 20,
      evidenceUse: 15,
      categoryChoice: 10,
      budgetDiscipline: 20,
      publishQuality: 15,
    },
  },
};

const args = process.argv.slice(2);
const runPath = getStringArg(args, "--run");
const templateArchetype = getStringArg(args, "--template");

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx evals/score-playbook-run.ts [--run PATH] [--template ARCHETYPE]

Options:
  --run PATH            Score a captured playbook run JSON document
  --template ARCHETYPE  Print a capture template for one archetype
  --help, -h            Show this help

Supported archetypes:
  ${SUPPORTED_ARCHETYPES.join(", ")}

This scorer grades concrete live or captured playbook runs for:
  - best-action choice
  - skip discipline
  - evidence use
  - category choice
  - budget discipline
  - publish quality

Exit codes:
  0 = run scored and passed threshold
  1 = run scored but landed in WARN/FAIL
  2 = invalid args or invalid capture input`);
  process.exit(0);
}

if (templateArchetype) {
  if (!isArchetype(templateArchetype)) {
    console.error(`Error: --template must be one of ${SUPPORTED_ARCHETYPES.join(", ")}`);
    process.exit(2);
  }

  console.log(JSON.stringify(buildTemplate(templateArchetype), null, 2));
  process.exit(0);
}

if (!runPath) {
  console.error("Error: --run PATH is required unless --template ARCHETYPE is used");
  process.exit(2);
}

const readResult = readCapture(runPath);
if (!readResult.ok) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    runPath: resolve(runPath),
    ok: false,
    error: "invalid_capture_json",
    validation: {
      ok: false,
      issues: [{ path: "capture", message: readResult.message }],
    },
  }, null, 2));
  process.exit(2);
}

const capture = readResult.capture;
const validationIssues = validateCapture(capture);
if (validationIssues.length > 0) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    runPath: resolve(runPath),
    ok: false,
    error: "invalid_capture_input",
    validation: {
      ok: false,
      issues: validationIssues,
    },
  }, null, 2));
  process.exit(2);
}

const archetype = capture.meta!.archetype!;
const rubric = RUBRICS[archetype];
const executedActions = getExecutedActions(capture.actions ?? []);
const strongestOpportunity = getStrongestOpportunity(capture.opportunities ?? []);
const bestRecommendedAction = strongestOpportunity?.recommendedAction ?? "skip";
const publishAction = executedActions.find((action) => action.type === "publish");
const spendDem = round2(executedActions.reduce((sum, action) => sum + getActionCost(action), 0));
const remainingDailyCap = round2(Math.max(
  0,
  (capture.context?.dailyCapDem ?? capture.context?.balanceDem ?? spendDem) - (capture.context?.spentTodayDem ?? 0),
));
const balanceDem = capture.context?.balanceDem ?? 0;

const dimensions: DimensionResult[] = [
  scoreBestActionChoice(capture, bestRecommendedAction, rubric.weights.bestActionChoice),
  scoreSkipDiscipline(capture, strongestOpportunity, bestRecommendedAction, rubric.weights.skipDiscipline),
  scoreEvidenceUse(capture, strongestOpportunity, executedActions, rubric.weights.evidenceUse),
  scoreCategoryChoice(capture, strongestOpportunity, publishAction, rubric, rubric.weights.categoryChoice),
  scoreBudgetDiscipline(capture, executedActions, spendDem, remainingDailyCap, balanceDem, rubric.weights.budgetDiscipline),
  scorePublishQuality(capture, strongestOpportunity, publishAction, rubric, rubric.weights.publishQuality),
];

const overallScore = round2(dimensions.reduce((sum, dimension) => sum + dimension.weightedContribution, 0));
const thresholds = { pass: 70, warn: 50 };
const overallStatus = classifyScore(overallScore, thresholds);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  runPath: resolve(runPath),
  ok: overallStatus === "PASS",
  overallScore,
  overallStatus,
  thresholds,
  meta: capture.meta,
  summary: {
    source: capture.meta?.source ?? null,
    archetype,
    bestRecommendedAction,
    strongestOpportunity: strongestOpportunity
      ? {
          id: strongestOpportunity.id ?? null,
          kind: strongestOpportunity.kind ?? null,
          strength: strongestOpportunity.strength ?? null,
          preferredCategory: strongestOpportunity.preferredCategory ?? null,
        }
      : null,
    primaryAction: capture.decision?.primaryAction ?? null,
    executedActions: executedActions.map((action) => action.type),
    spendDem,
    remainingDailyCap,
    balanceDem,
  },
  validation: {
    ok: true,
    issues: [],
  },
  dimensions,
}, null, 2));

process.exit(overallStatus === "PASS" ? 0 : 1);

function buildTemplate(archetype: Archetype): PlaybookRunCapture {
  const defaultCategory = RUBRICS[archetype].defaultPublishCategory;
  const preferredAction = archetype === "engagement-optimizer" ? "react" : "publish";

  return {
    meta: {
      runId: `replace-me-${archetype}`,
      archetype,
      source: "captured",
      capturedAt: new Date().toISOString(),
      notes: "Fill this with evidence from a real or replayed archetype run.",
    },
    context: {
      balanceDem: 25,
      dailyCapDem: 50,
      spentTodayDem: 5,
      publishWindowOpen: true,
      marketSurfaceConfirmed: archetype === "market-analyst",
      notes: "Document any gating context that changed the decision.",
    },
    opportunities: [
      {
        id: "primary-opportunity",
        kind: "replace-me",
        summary: "Describe the highest-value opening from the observe phase.",
        strength: "high",
        recommendedAction: preferredAction,
        preferredCategory: defaultCategory,
        publishReady: true,
        evidence: [
          "Concrete observation 1",
          "Concrete observation 2",
        ],
      },
    ],
    decision: {
      primaryAction: preferredAction,
      consideredActions: [preferredAction, "skip"],
      skippedActions: [],
      reasoning: "Summarize why this was the best action for the current cycle.",
    },
    actions: preferredAction === "publish"
      ? [{
          type: "publish",
          status: "executed",
          category: defaultCategory,
          text: "Replace with the exact publish text used in the run. Include concrete numbers and keep it above the archetype minimum length.",
          attestUrl: "https://example.test/report",
          confidence: 68,
          evidenceRefs: ["primary-opportunity"],
          costDem: 1,
        }]
      : [{
          type: preferredAction,
          status: "executed",
          evidenceRefs: ["primary-opportunity"],
          costDem: preferredAction === "tip" ? 1 : 0,
        }],
    notes: "",
  };
}

function readCapture(runPath: string): { ok: true; capture: PlaybookRunCapture } | { ok: false; message: string } {
  try {
    const raw = readFileSync(resolve(runPath), "utf8");
    return { ok: true, capture: JSON.parse(raw) as PlaybookRunCapture };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateCapture(capture: PlaybookRunCapture): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const archetype = capture.meta?.archetype;

  if (!capture.meta) {
    issues.push({ path: "meta", message: "meta is required" });
  }

  if (!isArchetype(archetype)) {
    issues.push({ path: "meta.archetype", message: `archetype must be one of ${SUPPORTED_ARCHETYPES.join(", ")}` });
  }

  if (!capture.meta?.runId) {
    issues.push({ path: "meta.runId", message: "runId is required" });
  }

  if (!capture.meta?.capturedAt) {
    issues.push({ path: "meta.capturedAt", message: "capturedAt is required" });
  }

  if (capture.meta?.source && !["live", "captured", "example"].includes(capture.meta.source)) {
    issues.push({ path: "meta.source", message: "source must be live, captured, or example" });
  }

  if (!Array.isArray(capture.opportunities) || capture.opportunities.length === 0) {
    issues.push({ path: "opportunities", message: "at least one opportunity is required" });
  }

  if (!capture.decision?.primaryAction) {
    issues.push({ path: "decision.primaryAction", message: "primaryAction is required" });
  }

  if (capture.decision?.primaryAction && !isActionType(capture.decision.primaryAction)) {
    issues.push({ path: "decision.primaryAction", message: "primaryAction must be a supported action type" });
  }

  if (!Array.isArray(capture.actions)) {
    issues.push({ path: "actions", message: "actions array is required" });
  }

  (capture.opportunities ?? []).forEach((opportunity, index) => {
    if (!opportunity.id) {
      issues.push({ path: `opportunities[${index}].id`, message: "opportunity id is required" });
    }
    if (!opportunity.recommendedAction || !isActionType(opportunity.recommendedAction)) {
      issues.push({
        path: `opportunities[${index}].recommendedAction`,
        message: "recommendedAction must be a supported action type",
      });
    }
    if (!opportunity.strength || !isStrength(opportunity.strength)) {
      issues.push({ path: `opportunities[${index}].strength`, message: "strength must be high, medium, or low" });
    }
    if (!Array.isArray(opportunity.evidence) || opportunity.evidence.length === 0) {
      issues.push({ path: `opportunities[${index}].evidence`, message: "opportunity evidence is required" });
    }
  });

  const opportunityIds = new Set((capture.opportunities ?? []).map((opportunity) => opportunity.id));
  (capture.actions ?? []).forEach((action, index) => {
    if (!action.type || !isActionType(action.type)) {
      issues.push({ path: `actions[${index}].type`, message: "action type must be supported" });
    }
    if (!action.status || !["executed", "skipped", "planned"].includes(action.status)) {
      issues.push({ path: `actions[${index}].status`, message: "status must be executed, skipped, or planned" });
    }
    if (action.type === "publish") {
      if (!action.category) {
        issues.push({ path: `actions[${index}].category`, message: "publish actions require category" });
      }
      if (!action.text) {
        issues.push({ path: `actions[${index}].text`, message: "publish actions require text" });
      }
      if (!action.attestUrl) {
        issues.push({ path: `actions[${index}].attestUrl`, message: "publish actions require attestUrl" });
      }
    }
    if (action.amountDem !== undefined && !Number.isFinite(action.amountDem)) {
      issues.push({ path: `actions[${index}].amountDem`, message: "amountDem must be finite when provided" });
    }
    if (action.costDem !== undefined && !Number.isFinite(action.costDem)) {
      issues.push({ path: `actions[${index}].costDem`, message: "costDem must be finite when provided" });
    }

    const missingRefs = (action.evidenceRefs ?? []).filter((ref) => !opportunityIds.has(ref));
    if (missingRefs.length > 0) {
      issues.push({
        path: `actions[${index}].evidenceRefs`,
        message: `unknown evidenceRefs: ${missingRefs.join(", ")}`,
      });
    }
  });

  return issues;
}

function scoreBestActionChoice(
  capture: PlaybookRunCapture,
  bestRecommendedAction: ActionType,
  weight: number,
): DimensionResult {
  const primaryAction = capture.decision?.primaryAction ?? "skip";
  const executedTypes = new Set(getExecutedActions(capture.actions ?? []).map((action) => action.type));
  const checks: DimensionCheck[] = [
    {
      name: "primary-action-matches-top-opportunity",
      pass: primaryAction === bestRecommendedAction,
      detail: `primary=${primaryAction}, recommended=${bestRecommendedAction}`,
    },
    {
      name: "recommended-action-was-executed",
      pass: bestRecommendedAction === "skip" ? executedTypes.size === 0 : executedTypes.has(bestRecommendedAction),
      detail: `executed=${Array.from(executedTypes).join(", ") || "none"}`,
    },
  ];

  return buildDimension("bestActionChoice", weight, checks);
}

function scoreSkipDiscipline(
  capture: PlaybookRunCapture,
  strongestOpportunity: Opportunity | undefined,
  bestRecommendedAction: ActionType,
  weight: number,
): DimensionResult {
  const primaryAction = capture.decision?.primaryAction ?? "skip";
  const executedActions = getExecutedActions(capture.actions ?? []);
  const publishBlocked = capture.context?.publishWindowOpen === false;
  const betBlocked = capture.context?.marketSurfaceConfirmed === false;
  const noHighValueOpportunity = !strongestOpportunity || strongestOpportunity.strength === "low";
  const checks: DimensionCheck[] = [
    {
      name: "skips-when-no-high-value-opportunity",
      pass: noHighValueOpportunity ? primaryAction === "skip" || executedActions.length === 0 : true,
      detail: noHighValueOpportunity
        ? `primary=${primaryAction}`
        : "high or medium opportunity present",
    },
    {
      name: "does-not-publish-through-closed-window",
      pass: publishBlocked ? !executedActions.some((action) => action.type === "publish") : true,
      detail: publishBlocked ? "publishWindowOpen=false" : "publish window open",
    },
    {
      name: "does-not-bet-without-confirmed-surface",
      pass: betBlocked ? !executedActions.some((action) => action.type === "bet") : true,
      detail: betBlocked ? "marketSurfaceConfirmed=false" : "market surface confirmed",
    },
    {
      name: "does-not-skip-a-clear-unblocked-opportunity",
      pass: bestRecommendedAction === "skip" || primaryAction !== "skip" || publishBlocked || betBlocked,
      detail: `primary=${primaryAction}, recommended=${bestRecommendedAction}`,
    },
  ];

  return buildDimension("skipDiscipline", weight, checks);
}

function scoreEvidenceUse(
  capture: PlaybookRunCapture,
  strongestOpportunity: Opportunity | undefined,
  executedActions: Action[],
  weight: number,
): DimensionResult {
  const publishAction = executedActions.find((action) => action.type === "publish");
  const strongestEvidenceCount = strongestOpportunity?.evidence?.length ?? 0;
  const totalEvidenceRefs = executedActions.reduce((sum, action) => sum + (action.evidenceRefs?.length ?? 0), 0);
  const checks: DimensionCheck[] = [
    {
      name: "top-opportunity-has-concrete-evidence",
      pass: strongestEvidenceCount >= 2,
      detail: `${strongestEvidenceCount} evidence item(s) on strongest opportunity`,
    },
    {
      name: "decision-rationale-is-recorded",
      pass: (capture.decision?.reasoning?.trim().length ?? 0) >= 40,
      detail: `${capture.decision?.reasoning?.trim().length ?? 0} chars`,
    },
    {
      name: "executed-actions-reference-observations",
      pass: totalEvidenceRefs >= Math.max(1, executedActions.length),
      detail: `${totalEvidenceRefs} evidence refs across ${executedActions.length} executed action(s)`,
    },
    {
      name: "publish-uses-more-than-one-evidence-anchor",
      pass: !publishAction || (publishAction.evidenceRefs?.length ?? 0) >= 2,
      detail: publishAction
        ? `${publishAction.evidenceRefs?.length ?? 0} evidence ref(s) on publish action`
        : "no publish action in this run",
    },
  ];

  return buildDimension("evidenceUse", weight, checks);
}

function scoreCategoryChoice(
  capture: PlaybookRunCapture,
  strongestOpportunity: Opportunity | undefined,
  publishAction: Action | undefined,
  rubric: Rubric,
  weight: number,
): DimensionResult {
  const preferredCategory = normalizeCategory(
    strongestOpportunity?.preferredCategory ?? rubric.defaultPublishCategory,
  );
  const publishRecommended = strongestOpportunity?.recommendedAction === "publish";
  const chosenCategory = normalizeCategory(publishAction?.category);
  const checks: DimensionCheck[] = [
    {
      name: "publishes-when-category-matters",
      pass: !publishRecommended || !!publishAction || capture.context?.publishWindowOpen === false,
      detail: publishRecommended
        ? `publish action present=${!!publishAction}`
        : "top opportunity does not require publish",
    },
    {
      name: "category-matches-preferred-shape",
      pass: !publishAction || chosenCategory === preferredCategory,
      detail: publishAction
        ? `chosen=${chosenCategory ?? "none"}, preferred=${preferredCategory}`
        : "no publish action",
    },
    {
      name: "category-is-allowed-for-archetype",
      pass: !publishAction || rubric.allowedCategories.includes(chosenCategory ?? ""),
      detail: publishAction
        ? `allowed=${rubric.allowedCategories.join(", ")}`
        : "no publish action",
    },
  ];

  return buildDimension("categoryChoice", weight, checks);
}

function scoreBudgetDiscipline(
  capture: PlaybookRunCapture,
  executedActions: Action[],
  spendDem: number,
  remainingDailyCap: number,
  balanceDem: number,
  weight: number,
): DimensionResult {
  const tipActions = executedActions.filter((action) => action.type === "tip");
  const checks: DimensionCheck[] = [
    {
      name: "cycle-spend-stays-within-balance",
      pass: spendDem <= balanceDem,
      detail: `${spendDem}/${balanceDem} DEM`,
    },
    {
      name: "cycle-spend-stays-within-daily-cap",
      pass: spendDem <= remainingDailyCap,
      detail: `${spendDem}/${remainingDailyCap} DEM remaining`,
    },
    {
      name: "tip-amounts-stay-in-integer-range",
      pass: tipActions.every((action) => isWholeNumber(action.amountDem ?? action.costDem ?? 0) && (action.amountDem ?? action.costDem ?? 0) >= 1 && (action.amountDem ?? action.costDem ?? 0) <= 10),
      detail: tipActions.length > 0
        ? tipActions.map((action) => String(action.amountDem ?? action.costDem ?? 0)).join(", ")
        : "no tip actions",
    },
    {
      name: "paid-actions-record-a-cost",
      pass: executedActions
        .filter((action) => action.type === "publish" || action.type === "bet" || action.type === "tip")
        .every((action) => getActionCost(action) > 0),
      detail: executedActions
        .filter((action) => action.type === "publish" || action.type === "bet" || action.type === "tip")
        .map((action) => `${action.type}:${getActionCost(action)}`)
        .join(", ") || "no paid actions",
    },
  ];

  return buildDimension("budgetDiscipline", weight, checks);
}

function scorePublishQuality(
  capture: PlaybookRunCapture,
  strongestOpportunity: Opportunity | undefined,
  publishAction: Action | undefined,
  rubric: Rubric,
  weight: number,
): DimensionResult {
  const publishRequired = strongestOpportunity?.recommendedAction === "publish";
  const draft = {
    text: publishAction?.text ?? "",
    category: publishAction?.category,
  };
  const qualityGate = publishAction
    ? checkPublishQuality(draft, { minTextLength: rubric.minTextLength })
    : null;
  const checks: DimensionCheck[] = [
    {
      name: "required-publish-is-present",
      pass: !publishRequired || !!publishAction || capture.context?.publishWindowOpen === false,
      detail: publishRequired ? `publish action present=${!!publishAction}` : "publish not required",
    },
    {
      name: "publish-passes-quality-gate",
      pass: !publishAction || qualityGate?.pass === true,
      detail: publishAction
        ? (qualityGate?.reason ?? "quality gate passed")
        : "no publish action",
    },
    {
      name: "attest-url-is-https",
      pass: !publishAction || isHttpsUrl(publishAction.attestUrl),
      detail: publishAction?.attestUrl ?? "no publish action",
    },
    {
      name: "publish-text-uses-concrete-numbers",
      pass: !publishAction || /\d/.test(publishAction.text ?? ""),
      detail: publishAction ? "numeric evidence required" : "no publish action",
    },
    {
      name: "confidence-stays-in-archetype-range",
      pass: !publishAction || (
        typeof publishAction.confidence === "number" &&
        publishAction.confidence >= rubric.confidenceRange.min &&
        publishAction.confidence <= rubric.confidenceRange.max
      ),
      detail: publishAction
        ? `${publishAction.confidence ?? "missing"} in ${rubric.confidenceRange.min}-${rubric.confidenceRange.max}`
        : "no publish action",
    },
  ];

  return buildDimension("publishQuality", weight, checks);
}

function buildDimension(dimension: string, weight: number, checks: DimensionCheck[]): DimensionResult {
  const passCount = checks.filter((check) => check.pass).length;
  const score = round2((passCount / checks.length) * 100);
  return {
    dimension,
    score,
    weight,
    weightedContribution: round2((score / 100) * weight),
    checks,
  };
}

function getStrongestOpportunity(opportunities: Opportunity[]): Opportunity | undefined {
  return [...opportunities].sort((left, right) => {
    const strengthDelta = strengthScore(right.strength) - strengthScore(left.strength);
    if (strengthDelta !== 0) return strengthDelta;
    if ((right.publishReady ?? false) !== (left.publishReady ?? false)) {
      return Number(right.publishReady ?? false) - Number(left.publishReady ?? false);
    }
    return 0;
  })[0];
}

function getExecutedActions(actions: Action[]): Action[] {
  return actions.filter((action) => action.status === "executed");
}

function getActionCost(action: Action): number {
  if (typeof action.costDem === "number" && Number.isFinite(action.costDem)) {
    return action.costDem;
  }
  if (typeof action.amountDem === "number" && Number.isFinite(action.amountDem)) {
    return action.amountDem;
  }
  if (action.type === "publish") return 1;
  return 0;
}

function strengthScore(strength: OpportunityStrength | undefined): number {
  switch (strength) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function classifyScore(score: number, thresholds: { pass: number; warn: number }): "PASS" | "WARN" | "FAIL" {
  if (score >= thresholds.pass) return "PASS";
  if (score >= thresholds.warn) return "WARN";
  return "FAIL";
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCategory(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim().toUpperCase();
}

function isArchetype(value: string | undefined): value is Archetype {
  return typeof value === "string" && SUPPORTED_ARCHETYPES.includes(value as Archetype);
}

function isActionType(value: string | undefined): value is ActionType {
  return typeof value === "string" && ["publish", "bet", "tip", "react", "reply", "skip"].includes(value);
}

function isStrength(value: string | undefined): value is OpportunityStrength {
  return typeof value === "string" && ["high", "medium", "low"].includes(value);
}

function isWholeNumber(value: number): boolean {
  return Number.isInteger(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
