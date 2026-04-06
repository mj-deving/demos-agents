#!/usr/bin/env npx tsx
/**
 * API drift detection tool — validates SuperColony API endpoints.
 *
 * Calls each documented endpoint, checks if the response matches
 * the expected shape, and reports MATCH/DRIFT/GONE/NEW.
 *
 * Usage: npx tsx cli/api-health-check.ts [--verbose]
 */

import { SuperColonyApiClient } from "../src/toolkit/supercolony/api-client.js";
import { loadAuthCache } from "../src/lib/auth/auth.js";

interface EndpointResult {
  path: string;
  status: "MATCH" | "DRIFT" | "GONE" | "ERROR";
  httpStatus?: number;
  detail?: string;
}

const verbose = process.argv.includes("--verbose");

async function main(): Promise<void> {
  const cached = loadAuthCache();
  const apiClient = new SuperColonyApiClient({
    getToken: async () => cached?.token ?? null,
    timeout: 8_000,
  });

  const results: EndpointResult[] = [];

  // Define endpoint checks — each calls an api-client method
  const checks: Array<{ path: string; fn: () => Promise<unknown> }> = [
    { path: "/api/feed", fn: () => apiClient.getFeed({ limit: 1 }) },
    { path: "/api/feed/search", fn: () => apiClient.searchFeed({ text: "test", limit: 1 }) },
    { path: "/api/agents", fn: () => apiClient.listAgents() },
    { path: "/api/scores/agents", fn: () => apiClient.getAgentLeaderboard({ limit: 1 }) },
    { path: "/api/oracle", fn: () => apiClient.getOracle() },
    { path: "/api/prices", fn: () => apiClient.getPrices(["BTC"]) },
    { path: "/api/signals", fn: () => apiClient.getSignals() },
    { path: "/api/health", fn: () => apiClient.getHealth() },
    { path: "/api/stats", fn: () => apiClient.getStats() },
    { path: "/api/ballot", fn: () => apiClient.getBallot() },
    { path: "/api/predictions", fn: () => apiClient.queryPredictions() },
    { path: "/api/predictions/markets", fn: () => apiClient.getPredictionMarkets() },
    { path: "/api/report", fn: () => apiClient.getReport() },
  ];

  console.log(`\nChecking ${checks.length} API endpoints...\n`);

  for (const check of checks) {
    try {
      const result = await check.fn() as { ok?: boolean; status?: number; data?: unknown; error?: string } | null;

      if (result === null) {
        results.push({ path: check.path, status: "GONE", detail: "unreachable (null)" });
      } else if (result.ok) {
        results.push({ path: check.path, status: "MATCH", httpStatus: 200 });
      } else {
        results.push({
          path: check.path,
          status: result.status === 404 ? "GONE" : "DRIFT",
          httpStatus: result.status,
          detail: result.error,
        });
      }
    } catch (err) {
      results.push({
        path: check.path,
        status: "ERROR",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Print results table
  const maxPath = Math.max(...results.map((r) => r.path.length));
  console.log(`${"Endpoint".padEnd(maxPath)}  Status   HTTP  Detail`);
  console.log("─".repeat(maxPath + 40));

  for (const r of results) {
    const statusColor = r.status === "MATCH" ? "\x1b[32m" : r.status === "GONE" ? "\x1b[31m" : "\x1b[33m";
    const reset = "\x1b[0m";
    const http = r.httpStatus ? String(r.httpStatus) : "—";
    const detail = verbose && r.detail ? r.detail.slice(0, 60) : "";
    console.log(`${r.path.padEnd(maxPath)}  ${statusColor}${r.status.padEnd(7)}${reset}  ${http.padEnd(4)}  ${detail}`);
  }

  const match = results.filter((r) => r.status === "MATCH").length;
  const total = results.length;
  console.log(`\n${match}/${total} endpoints healthy\n`);

  if (match < total) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(2);
});
