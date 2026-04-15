#!/usr/bin/env npx tsx
/**
 * check-endpoint-surface.ts — Probe audited live endpoints and expected 404 resources.
 *
 * AgentSkills spec: non-interactive, structured output, --help, deterministic.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = all probes match expected classification, 1 = drift or fetch error, 2 = invalid args.
 */

import {
  DEFAULT_BASE_URL,
  fetchText,
  getNumberArg,
  getStringArg,
  hasFlag,
} from "./_shared.js";

type ExpectedStatus = "ok" | "not_found" | "auth_required";
type Probe = {
  path: string;
  expected: ExpectedStatus;
  expectedHttpStatus?: number;
  method?: "GET" | "POST";
  body?: unknown;
};

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-endpoint-surface.ts [--base-url URL] [--timeout-ms N] [--include-eth-bets] [--include-sports-commodity] [--include-intelligence] [--include-bet-registration]

Options:
  --base-url URL   SuperColony base URL (default: ${DEFAULT_BASE_URL})
  --timeout-ms N   Request timeout in milliseconds (default: 15000)
  --include-eth-bets  Include ETH betting endpoints in the probe set
  --include-sports-commodity  Include sports and commodity betting endpoints
  --include-intelligence  Include prediction intelligence endpoints
  --include-bet-registration  Include manual bet-registration POST routes
  Deprecated aliases: --include-scdev-eth, --include-scdev-sports-commodity, --include-scdev-intelligence
  --help, -h       Show this help

Output: JSON report of endpoint classifications versus expected audit classifications
Exit codes: 0 = matches audit expectations, 1 = drift or fetch error, 2 = invalid args`);
  process.exit(0);
}

const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;
const timeoutMs = getNumberArg(args, "--timeout-ms") ?? 15_000;
const includeEthBets = hasFlag(args, "--include-eth-bets") || hasFlag(args, "--include-scdev-eth");
const includeSportsCommodity = hasFlag(args, "--include-sports-commodity") || hasFlag(args, "--include-scdev-sports-commodity");
const includeIntelligence = hasFlag(args, "--include-intelligence") || hasFlag(args, "--include-scdev-intelligence");
const includeBetRegistration = hasFlag(args, "--include-bet-registration");

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("Error: --timeout-ms must be a positive number");
  process.exit(2);
}

const probes: Probe[] = [
  { path: "/llms-full.txt", expected: "ok" },
  { path: "/openapi.json", expected: "ok" },
  { path: "/.well-known/ai-plugin.json", expected: "ok" },
  { path: "/.well-known/agents.json", expected: "ok" },
  { path: "/.well-known/agent.json", expected: "ok" },
  { path: "/api/feed?limit=1", expected: "ok" },
  { path: "/api/stats", expected: "ok" },
  { path: "/api/oracle", expected: "ok" },
  { path: "/api/prices?assets=BTC", expected: "ok" },
  { path: "/api/convergence", expected: "ok" },
  { path: "/api/report", expected: "ok" },
  { path: "/api/bets/pool?asset=BTC&horizon=30m", expected: "ok" },
  { path: "/api/bets/higher-lower/pool?asset=BTC&horizon=30m", expected: "ok" },
  { path: "/api/capabilities", expected: "not_found" },
  { path: "/api/rate-limits", expected: "not_found" },
  { path: "/api/changelog", expected: "not_found" },
  { path: "/api/agents/onboard", expected: "not_found" },
  { path: "/api/errors", expected: "not_found" },
  { path: "/api/mcp/tools", expected: "not_found" },
  { path: "/api/stream-spec", expected: "not_found" },
  { path: "/.well-known/mcp.json", expected: "not_found" },
  ...(includeEthBets
    ? [
        { path: "/api/bets/eth/pool?asset=BTC&horizon=30m", expected: "ok" as const },
        { path: "/api/bets/eth/winners?asset=BTC", expected: "ok" as const },
        { path: "/api/bets/eth/hl/pool?asset=BTC&horizon=30m", expected: "ok" as const },
        { path: "/api/bets/eth/binary/pools", expected: "ok" as const },
      ]
    : []),
  ...(includeSportsCommodity
    ? [
        { path: "/api/bets/sports/markets?status=upcoming", expected: "ok" as const },
        { path: "/api/bets/sports/pool?fixtureId=nba_espn_401866757", expected: "ok" as const },
        { path: "/api/bets/sports/winners?fixtureId=nba_espn_401866757", expected: "ok" as const },
        { path: "/api/bets/commodity/pool?asset=XAU&horizon=30m", expected: "ok" as const },
      ]
    : []),
  ...(includeIntelligence
    ? [
        { path: "/api/predictions/intelligence?limit=5&stats=true", expected: "ok" as const },
        { path: "/api/predictions/recommend?userAddress=demo", expected: "ok" as const },
      ]
    : []),
  ...(includeBetRegistration
    ? [
        {
          path: "/api/bets/place",
          expected: "ok" as const,
          method: "POST" as const,
          body: {
            txHash: "a".repeat(64),
            asset: "BTC",
            predictedPrice: 70_000,
            horizon: "30m",
          },
        },
        {
          path: "/api/bets/higher-lower/place",
          expected: "ok" as const,
          method: "POST" as const,
          body: {
            txHash: "a".repeat(64),
            asset: "BTC",
            direction: "HIGHER",
            horizon: "30m",
          },
        },
        {
          path: "/api/bets/eth/binary/place",
          expected: "not_found" as const,
          expectedHttpStatus: 404,
          method: "POST" as const,
          body: {
            txHash: `0x${"a".repeat(64)}`,
          },
        },
      ]
    : []),
];

void main();

async function main(): Promise<void> {
  const responses = await Promise.all(
    probes.map((probe) => fetchText(probe.path, {
      baseUrl,
      timeoutMs,
      method: probe.method,
      body: probe.body,
    })),
  );

  const results = probes.map((probe, index) => {
    const response = responses[index];
    const actual = classifyStatus(response.status);
    const matches = !response.error
      && (probe.expectedHttpStatus !== undefined
        ? response.status === probe.expectedHttpStatus
        : actual === probe.expected);

    return {
      path: probe.path,
      method: probe.method ?? "GET",
      expected: probe.expected,
      expectedHttpStatus: probe.expectedHttpStatus,
      actual,
      httpStatus: response.status,
      match: matches,
      error: response.error,
    };
  });

  const ok = results.every((result) => result.match);

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    baseUrl,
    ok,
    results,
  }, null, 2));

  process.exit(ok ? 0 : 1);
}

function classifyStatus(status: number): ExpectedStatus | "unexpected_status" | "network_error" {
  if (status === 0) return "network_error";
  if (status === 200) return "ok";
  if (status === 401 || status === 403) return "auth_required";
  if (status === 404) return "not_found";
  return "unexpected_status";
}
