#!/usr/bin/env npx tsx
/**
 * run-trajectories.ts — Score recorded trajectory traces against evals/trajectories.yaml.
 *
 * This does not execute live multi-turn agent sessions itself. Instead, it scores
 * a concrete recorded trace file against the maintained trajectory specification.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = scored successfully and meets threshold, 1 = scored successfully but below threshold, 2 = invalid args/input
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

type JsonRecord = Record<string, unknown>;
type StepStatus = "pass" | "fail" | "skip";

interface TrajectorySpec {
  description?: string;
  scenarios?: ScenarioSpec[];
  scoring?: {
    weights?: Record<string, number>;
    thresholds?: Record<string, number>;
  };
}

interface ScenarioSpec {
  id?: string;
  description?: string;
  steps?: StepSpec[];
  scoring?: Record<string, number>;
}

interface StepSpec {
  action?: string;
  assert?: string[];
}

interface TraceDoc {
  meta?: JsonRecord;
  scenarios?: ScenarioTrace[];
}

interface ScenarioTrace {
  id?: string;
  steps?: StepTrace[];
  metrics?: Record<string, MetricTrace>;
  notes?: string;
}

interface StepTrace {
  action?: string;
  status?: StepStatus;
  assertions?: AssertionTrace[];
  notes?: string;
}

interface AssertionTrace {
  text?: string;
  passed?: boolean;
  evidence?: string;
}

interface MetricTrace {
  passed?: boolean;
  score?: number;
  evidence?: string;
}

interface ValidationIssue {
  path: string;
  message: string;
}

interface TraceValidation {
  ok: boolean;
  issues: ValidationIssue[];
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx evals/run-trajectories.ts [--trace PATH] [--scenario ID] [--template]

Options:
  --trace PATH    Trace JSON file to score against evals/trajectories.yaml
  --scenario ID   Score only one scenario id
  --template      Print a JSON trace template derived from the trajectory spec
  --help, -h      Show this help

Trace format:
  {
    "meta": { "runId": "..." },
    "scenarios": [
      {
        "id": "publish-flow",
        "metrics": {
          "correctOrder": { "passed": true, "evidence": "..." }
        },
        "steps": [
          {
            "action": "Read signals with getSignals()",
            "status": "pass",
            "assertions": [
              { "text": "Returns SignalData[] or null", "passed": true, "evidence": "..." }
            ]
          }
        ]
      }
    ]
  }

Output: JSON report with per-scenario scoring and overall threshold classification
Exit codes: 0 = pass, 1 = warn/fail threshold, 2 = invalid args/input`);
  process.exit(0);
}

const templateOnly = args.includes("--template");
const tracePath = getStringArg(args, "--trace");
const scenarioFilter = getStringArg(args, "--scenario");
const packageRoot = resolve(import.meta.dirname, "..");
const trajectoriesPath = resolve(packageRoot, "evals", "trajectories.yaml");
const spec = parse(readFileSync(trajectoriesPath, "utf8")) as TrajectorySpec;
const scenarios = Array.isArray(spec.scenarios) ? spec.scenarios : [];
const selectedScenarios = scenarioFilter
  ? scenarios.filter((scenario) => scenario.id === scenarioFilter)
  : scenarios;

if (selectedScenarios.length === 0) {
  console.error(`No trajectory scenarios matched${scenarioFilter ? `: ${scenarioFilter}` : ""}`);
  process.exit(2);
}

if (templateOnly) {
  console.log(JSON.stringify(buildTemplate(selectedScenarios), null, 2));
  process.exit(0);
}

if (!tracePath) {
  console.error("Error: --trace PATH is required unless --template is used");
  process.exit(2);
}

const traceFile = readTraceFile(tracePath);
if (!traceFile.ok) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    trajectoriesPath,
    tracePath: resolve(tracePath),
    scenarioFilter: scenarioFilter ?? null,
    ok: false,
    error: "invalid_trace_json",
    validation: {
      ok: false,
      issues: [
        {
          path: "trace",
          message: traceFile.message,
        },
      ],
    },
  }, null, 2));
  process.exit(2);
}

const trace = traceFile.trace;
const validation = validateTrace(trace, scenarios);
if (!validation.ok) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    trajectoriesPath,
    tracePath: resolve(tracePath),
    scenarioFilter: scenarioFilter ?? null,
    ok: false,
    error: "invalid_trace_input",
    validation,
  }, null, 2));
  process.exit(2);
}

const traceScenarios = Array.isArray(trace.scenarios) ? trace.scenarios : [];
const thresholds = isRecord(spec.scoring?.thresholds) ? spec.scoring!.thresholds! : { pass: 70, warn: 50, fail: 0 };

const results = selectedScenarios.map((scenario) => {
  const traceScenario = traceScenarios.find((entry) => entry.id === scenario.id);
  return scoreScenario(scenario, traceScenario);
});

const overallScore = round2(results.reduce((sum, result) => sum + result.score, 0) / results.length);
const overallStatus = results.every((result) => result.status === "PASS")
  ? classifyScore(overallScore, thresholds)
  : "FAIL";
const ok = overallStatus === "PASS";

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  trajectoriesPath,
  tracePath: resolve(tracePath),
  scenarioFilter: scenarioFilter ?? null,
  ok,
  overallScore,
  overallStatus,
  thresholds,
  validation,
  results,
}, null, 2));

process.exit(ok ? 0 : 1);

function scoreScenario(specScenario: ScenarioSpec, traceScenario?: ScenarioTrace) {
  const specSteps = Array.isArray(specScenario.steps) ? specScenario.steps : [];
  const traceSteps = Array.isArray(traceScenario?.steps) ? traceScenario!.steps : [];
  const scoring = isRecord(specScenario.scoring) ? specScenario.scoring as Record<string, number> : {};
  const metricEntries = Object.entries(scoring);

  const stepResults = specSteps.map((specStep, index) => {
    const traceStep = traceSteps[index];
    const actionMatches = !!traceStep && traceStep.action === specStep.action;
    const traceAssertions = Array.isArray(traceStep?.assertions) ? traceStep!.assertions : [];
    const assertionResults = (specStep.assert ?? []).map((expected) => {
      const actual = traceAssertions.find((entry) => entry.text === expected);
      return {
        text: expected,
        present: !!actual,
        passed: actual?.passed === true,
        evidence: actual?.evidence ?? null,
      };
    });

    return {
      action: specStep.action ?? null,
      traceAction: traceStep?.action ?? null,
      actionMatches,
      status: traceStep?.status ?? null,
      assertionResults,
      notes: traceStep?.notes ?? null,
      assertionPassRate: assertionResults.length === 0
        ? 0
        : round2(assertionResults.filter((entry) => entry.present && entry.passed).length / assertionResults.length),
    };
  });

  const metricResults = metricEntries.map(([metric, weight]) => {
    const traceMetric = isRecord(traceScenario?.metrics) ? traceScenario!.metrics![metric] as MetricTrace | undefined : undefined;
    const normalizedScore = normalizeMetric(traceMetric);
    return {
      metric,
      weight,
      score: round2(normalizedScore * 100),
      weightedContribution: round2(normalizedScore * weight),
      evidence: traceMetric?.evidence ?? null,
      present: !!traceMetric,
    };
  });

  const score = round2(metricResults.reduce((sum, metric) => sum + metric.weightedContribution, 0));
  const thresholds = isRecord(spec.scoring?.thresholds) ? spec.scoring!.thresholds! : { pass: 70, warn: 50, fail: 0 };
  const stepCoverage = {
    expectedSteps: specSteps.length,
    matchedSteps: stepResults.filter((step) => step.actionMatches && step.status === "pass").length,
    expectedAssertions: stepResults.reduce((sum, step) => sum + step.assertionResults.length, 0),
    matchedAssertions: stepResults.reduce((sum, step) => (
      sum + step.assertionResults.filter((entry) => entry.present && entry.passed).length
    ), 0),
  };
  const hasCompleteCoverage =
    !!traceScenario &&
    stepCoverage.matchedSteps === stepCoverage.expectedSteps &&
    stepCoverage.matchedAssertions === stepCoverage.expectedAssertions;
  const scoreStatus = classifyScore(score, thresholds);
  const status = hasCompleteCoverage ? scoreStatus : "FAIL";

  return {
    id: specScenario.id ?? "<invalid>",
    description: specScenario.description ?? null,
    tracePresent: !!traceScenario,
    score,
    status,
    scoreStatus,
    coverageOk: hasCompleteCoverage,
    statusReason: hasCompleteCoverage
      ? null
      : "trace is missing required step/action/assertion coverage",
    stepCoverage,
    stepResults,
    metricResults,
    notes: traceScenario?.notes ?? null,
    missingTrace: !traceScenario,
  };
}

function buildTemplate(scenarios: ScenarioSpec[]): TraceDoc {
  return {
    meta: {
      runId: "replace-me",
      capturedAt: new Date().toISOString(),
      notes: "Fill this with evidence from a concrete agent session run.",
    },
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id ?? "replace-me",
      notes: "",
      metrics: Object.fromEntries(
        Object.keys(isRecord(scenario.scoring) ? scenario.scoring as Record<string, number> : {}).map((metric) => [
          metric,
          {
            passed: false,
            evidence: "",
          },
        ]),
      ),
      steps: (scenario.steps ?? []).map((step) => ({
        action: step.action ?? "",
        status: "fail",
        notes: "",
        assertions: (step.assert ?? []).map((text) => ({
          text,
          passed: false,
          evidence: "",
        })),
      })),
    })),
  };
}

function readTraceFile(tracePath: string): { ok: true; trace: TraceDoc } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      trace: JSON.parse(readFileSync(resolve(tracePath), "utf8")) as TraceDoc,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateTrace(trace: TraceDoc, specScenarios: ScenarioSpec[]): TraceValidation {
  const issues: ValidationIssue[] = [];
  const validStatuses: StepStatus[] = ["pass", "fail", "skip"];
  const specById = new Map(
    specScenarios
      .filter((scenario): scenario is ScenarioSpec & { id: string } => typeof scenario.id === "string" && scenario.id.length > 0)
      .map((scenario) => [scenario.id, scenario]),
  );

  if (!isRecord(trace)) {
    return {
      ok: false,
      issues: [
        {
          path: "trace",
          message: "trace document must be a JSON object",
        },
      ],
    };
  }

  if (!Array.isArray(trace.scenarios)) {
    return {
      ok: false,
      issues: [
        {
          path: "trace.scenarios",
          message: "trace.scenarios must be an array",
        },
      ],
    };
  }

  if (trace.scenarios.length === 0) {
    issues.push({
      path: "trace.scenarios",
      message: "trace.scenarios must include at least one scenario entry",
    });
  }

  const seenScenarioIds = new Set<string>();

  trace.scenarios.forEach((scenario, scenarioIndex) => {
    const scenarioPath = `trace.scenarios[${scenarioIndex}]`;

    if (!isRecord(scenario)) {
      issues.push({
        path: scenarioPath,
        message: "scenario entry must be an object",
      });
      return;
    }

    if (typeof scenario.id !== "string" || scenario.id.length === 0) {
      issues.push({
        path: `${scenarioPath}.id`,
        message: "scenario id must be a non-empty string",
      });
      return;
    }

    if (seenScenarioIds.has(scenario.id)) {
      issues.push({
        path: `${scenarioPath}.id`,
        message: `duplicate scenario id '${scenario.id}'`,
      });
    } else {
      seenScenarioIds.add(scenario.id);
    }

    const specScenario = specById.get(scenario.id);
    if (!specScenario) {
      issues.push({
        path: `${scenarioPath}.id`,
        message: `scenario id '${scenario.id}' is not defined in evals/trajectories.yaml`,
      });
      return;
    }

    if (scenario.metrics !== undefined && !isRecord(scenario.metrics)) {
      issues.push({
        path: `${scenarioPath}.metrics`,
        message: "metrics must be an object when provided",
      });
    } else if (isRecord(scenario.metrics)) {
      const expectedMetrics = new Set(Object.keys(isRecord(specScenario.scoring) ? specScenario.scoring as Record<string, number> : {}));
      for (const [metricName, metricValue] of Object.entries(scenario.metrics)) {
        const metricPath = `${scenarioPath}.metrics.${metricName}`;
        if (!expectedMetrics.has(metricName)) {
          issues.push({
            path: metricPath,
            message: `unknown metric '${metricName}' for scenario '${scenario.id}'`,
          });
          continue;
        }
        if (!isRecord(metricValue)) {
          issues.push({
            path: metricPath,
            message: "metric entry must be an object",
          });
          continue;
        }
        if (metricValue.passed !== undefined && typeof metricValue.passed !== "boolean") {
          issues.push({
            path: `${metricPath}.passed`,
            message: "passed must be a boolean when provided",
          });
        }
        if (metricValue.score !== undefined && (typeof metricValue.score !== "number" || !Number.isFinite(metricValue.score))) {
          issues.push({
            path: `${metricPath}.score`,
            message: "score must be a finite number when provided",
          });
        }
        if (metricValue.evidence !== undefined && typeof metricValue.evidence !== "string") {
          issues.push({
            path: `${metricPath}.evidence`,
            message: "evidence must be a string when provided",
          });
        }
      }
    }

    if (scenario.steps !== undefined && !Array.isArray(scenario.steps)) {
      issues.push({
        path: `${scenarioPath}.steps`,
        message: "steps must be an array when provided",
      });
    } else if (Array.isArray(scenario.steps)) {
      scenario.steps.forEach((step, stepIndex) => {
        const stepPath = `${scenarioPath}.steps[${stepIndex}]`;
        if (!isRecord(step)) {
          issues.push({
            path: stepPath,
            message: "step entry must be an object",
          });
          return;
        }
        if (step.action !== undefined && typeof step.action !== "string") {
          issues.push({
            path: `${stepPath}.action`,
            message: "action must be a string when provided",
          });
        }
        if (step.status !== undefined && !validStatuses.includes(step.status as StepStatus)) {
          issues.push({
            path: `${stepPath}.status`,
            message: "status must be one of pass, fail, or skip when provided",
          });
        }
        if (step.assertions !== undefined && !Array.isArray(step.assertions)) {
          issues.push({
            path: `${stepPath}.assertions`,
            message: "assertions must be an array when provided",
          });
        } else if (Array.isArray(step.assertions)) {
          step.assertions.forEach((assertion, assertionIndex) => {
            const assertionPath = `${stepPath}.assertions[${assertionIndex}]`;
            if (!isRecord(assertion)) {
              issues.push({
                path: assertionPath,
                message: "assertion entry must be an object",
              });
              return;
            }
            if (assertion.text !== undefined && typeof assertion.text !== "string") {
              issues.push({
                path: `${assertionPath}.text`,
                message: "text must be a string when provided",
              });
            }
            if (assertion.passed !== undefined && typeof assertion.passed !== "boolean") {
              issues.push({
                path: `${assertionPath}.passed`,
                message: "passed must be a boolean when provided",
              });
            }
            if (assertion.evidence !== undefined && typeof assertion.evidence !== "string") {
              issues.push({
                path: `${assertionPath}.evidence`,
                message: "evidence must be a string when provided",
              });
            }
          });
        }
      });
    }
  });

  return {
    ok: issues.length === 0,
    issues,
  };
}

function normalizeMetric(metric: MetricTrace | undefined): number {
  if (!metric) return 0;
  if (typeof metric.score === "number" && Number.isFinite(metric.score)) {
    return metric.score > 1 ? clamp(metric.score / 100, 0, 1) : clamp(metric.score, 0, 1);
  }
  if (metric.passed === true) return 1;
  return 0;
}

function classifyScore(score: number, thresholds: Record<string, number>): "PASS" | "WARN" | "FAIL" {
  const pass = typeof thresholds.pass === "number" ? thresholds.pass : 70;
  const warn = typeof thresholds.warn === "number" ? thresholds.warn : 50;
  if (score >= pass) return "PASS";
  if (score >= warn) return "WARN";
  return "FAIL";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStringArg(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}
