#!/usr/bin/env python3
"""
shape-cross-check.py — Compare live API audit data against types.ts & response-shapes.md

Usage:
  # First, produce an audit JSON with --samples --auth:
  npx tsx scripts/api-depth-audit.ts --samples --auth > /tmp/audit.json

  # Then cross-check:
  python3 scripts/shape-cross-check.py /tmp/audit.json

  # Or use the default location (last --auth run):
  python3 scripts/shape-cross-check.py

Produces a mismatch report:
  - Fields in live API not in our TypeScript interfaces
  - Fields in our interfaces not in live API
  - Type mismatches (e.g., string vs number)
  - Array item field discrepancies
"""

import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_AUDIT = "/tmp/api-depth-authed2.json"

# ── Expected shapes from types.ts / response-shapes.md ────────────────────────
#
# Maintain this map when types.ts changes. Each entry defines:
#   top: set of expected top-level fields
#   type_of: optional dict of field → expected JS type name
#   array_items: optional dict of array field → expected item fields
#   notes: which TypeScript interface this maps to

EXPECTED_SHAPES: dict[str, dict[str, Any]] = {
    "feed.getRecent": {
        "top": {"posts", "hasMore", "query", "meta"},
        "notes": "FeedResponse",
    },
    "feed.search": {
        "top": {"posts", "hasMore", "query", "meta"},
        "notes": "FeedResponse (search)",
    },
    "feed.getPost": {
        "top": {"post", "parent", "replies"},
        "notes": "PostDetail",
    },
    "feed.getThread": {
        "top": {"root", "replies"},
        "notes": "ThreadResponse",
    },
    "signals.get": {
        "top": {"consensusAnalysis", "computed", "window", "signalAgent",
                "clusterAgent", "embedder", "meta"},
        "notes": "SignalsResponse (unwrapped to SignalData[])",
    },
    "convergence.get": {
        "top": {"pulse", "mindshare", "stats", "cached"},
        "notes": "ConvergenceResponse",
    },
    "report.get": {
        "top": {"id", "title", "summary", "script", "audioUrl", "signalCount",
                "postCount", "agentCount", "sources", "status", "createdAt", "publishedAt"},
        "notes": "ReportResponse",
    },
    "oracle.get": {
        "top": {"overallSentiment", "assets", "polymarket", "divergences", "meta"},
        "notes": "OracleResult",
    },
    "oracle.getFiltered": {
        "top": {"overallSentiment", "assets", "polymarket", "divergences", "meta"},
        "notes": "OracleResult (filtered)",
    },
    "prices.get": {
        "top": {"prices", "fetchedAt", "stale"},
        "notes": "PricesResponse → PriceData[]",
    },
    "prices.getHistory": {
        "top": {"prices", "fetchedAt", "stale", "history"},
        "notes": "PriceHistoryResponse",
    },
    "agents.list": {
        "top": {"agents", "total"},
        "notes": "{ agents: AgentProfile[], total }",
    },
    "agents.getProfile": {
        "top": {"address", "name", "description", "specialties", "postCount",
                "lastActiveAt", "displayName", "registeredAt", "lastSeen",
                "nameChangedAt", "categoryBreakdown", "web2Identities",
                "xmIdentities", "swarmOwner"},
        "notes": "AgentProfile",
    },
    "agents.getIdentities": {
        "top": {"web2Identities", "xmIdentities"},
        "notes": "AgentIdentities",
    },
    "agents.getBalance": {
        "top": {"balance", "updatedAt"},
        "type_of": {"balance": "number"},
        "notes": "AgentBalanceResponse",
    },
    "scores.leaderboard": {
        "top": {"agents", "count", "globalAvg", "confidenceThreshold"},
        "notes": "LeaderboardResult",
    },
    "scores.topPosts": {
        "top": {"posts", "count"},
        "array_items": {
            "posts": {"txHash", "author", "category", "text", "score",
                      "timestamp", "blockNumber", "confidence"},
        },
        "notes": "TopPostsResult",
    },
    "health.check": {
        "top": {"status", "uptime", "timestamp", "memory"},
        "notes": "HealthStatus",
    },
    "stats.get": {
        "top": {"network", "activity", "quality", "predictions", "tips",
                "consensus", "content", "computedAt"},
        "notes": "NetworkStats",
    },
    "predictions.query": {
        "top": {"predictions", "total"},
        "array_items": {
            "predictions": {"txHash", "author", "asset", "predictedPrice",
                            "actualPrice", "accuracy", "status", "evidence",
                            "resolvedAt", "resolvedBy"},
        },
        "notes": "Prediction[]",
    },
    "predictions.markets": {
        "top": {"predictions", "count", "categories"},
        "notes": "PredictionMarketsResponse",
    },
    "ballot.getPool": {
        "top": {"asset", "horizon", "totalBets", "totalDem", "poolAddress",
                "roundEnd", "bets"},
        "notes": "BettingPool",
    },
    "ballot.higherLower": {
        "top": {"asset", "horizon", "totalHigher", "totalLower", "totalDem",
                "higherCount", "lowerCount", "roundEnd", "referencePrice",
                "poolAddress", "currentPrice"},
        "notes": "HigherLowerPool",
    },
    "ballot.binaryPools": {
        "top": {"pools", "count"},
        "notes": "{ pools: Record<string, BinaryPool> }",
    },
    "actions.getReactions": {
        "top": {"agree", "disagree", "flag"},
        "notes": "{ agree, disagree, flag }",
    },
    "actions.getTipStats": {
        "top": {"totalTips", "totalDem", "tippers", "topTip"},
        "notes": "TipStats",
    },
    "actions.getAgentTips": {
        "top": {"tipsGiven", "tipsReceived"},
        "notes": "AgentTipStats",
    },
    "identity.search": {
        "top": {"results", "totalMatches"},
        "notes": "IdentitySearchResult",
    },
    "identity.byPlatform": {
        "top": {"query", "result"},
        "notes": "{ query, result: IdentityResult }",
    },
    "webhooks.list": {
        "top": {"webhooks"},
        "notes": "{ webhooks: Webhook[] }",
    },
    "verify.dahr": {
        "top": {"verified", "attestations"},
        "notes": "DahrVerification",
    },
    "verify.tlsn": {
        "top": {"verified", "proof", "txHash"},
        "notes": "TlsnVerification",
    },
}


def extract_top_level(fields: list[str]) -> set[str]:
    """Extract top-level field names from dot-path field list."""
    top = set()
    for f in fields:
        path = f.split(":")[0].strip()
        top_name = path.split(".")[0].split("[")[0]
        top.add(top_name)
    return top


def extract_array_item_fields(fields: list[str], array_name: str) -> set[str]:
    """Extract item-level fields for an array field."""
    prefix = f"{array_name}[]."
    item_fields = set()
    for f in fields:
        if prefix in f:
            item_field = f.split(prefix)[1].split(":")[0].split(".")[0].strip()
            item_fields.add(item_field)
    return item_fields


def main() -> None:
    audit_file = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_AUDIT
    if not Path(audit_file).exists():
        print(f"Audit file not found: {audit_file}")
        print("Run: npx tsx scripts/api-depth-audit.ts --samples --auth > /tmp/audit.json")
        sys.exit(1)

    with open(audit_file) as f:
        audit = json.load(f)

    ok_eps = [e for e in audit if e["ok"]]
    fail_eps = [e for e in audit if not e["ok"]]

    print("=" * 90)
    print(f"LIVE vs TYPES CROSS-CHECK — {len(ok_eps)} OK, {len(fail_eps)} failed")
    print("=" * 90)

    findings: list[dict[str, Any]] = []

    for ep in ok_eps:
        name = ep["name"]
        fields = ep["fields"]
        raw = ep.get("rawData")
        live_top = extract_top_level(fields)

        if name not in EXPECTED_SHAPES:
            continue

        exp = EXPECTED_SHAPES[name]
        exp_top = exp["top"]

        in_live_not_types = live_top - exp_top
        in_types_not_live = exp_top - live_top

        ep_findings: list[str] = []

        if in_live_not_types:
            ep_findings.append(
                f"  🆕 IN LIVE, NOT IN TYPES: {', '.join(sorted(in_live_not_types))}"
            )
        if in_types_not_live:
            ep_findings.append(
                f"  ❌ IN TYPES, NOT IN LIVE: {', '.join(sorted(in_types_not_live))}"
            )

        # Type checks
        if "type_of" in exp and raw:
            for field_name, expected_type in exp["type_of"].items():
                if field_name in raw:
                    actual_val = raw[field_name]
                    actual_type = type(actual_val).__name__
                    if actual_type == "str" and expected_type == "number":
                        ep_findings.append(
                            f"  ⚠️  TYPE MISMATCH: {field_name} is {actual_type} "
                            f"(value: {repr(actual_val)[:40]}), types.ts says {expected_type}"
                        )
                    elif actual_type == "int" and expected_type == "string":
                        ep_findings.append(
                            f"  ⚠️  TYPE MISMATCH: {field_name} is {actual_type}, "
                            f"types.ts says {expected_type}"
                        )

        # Array item field checks
        if "array_items" in exp:
            for arr_name, expected_item_fields in exp["array_items"].items():
                live_items = extract_array_item_fields(fields, arr_name)
                if live_items:
                    extra = live_items - expected_item_fields
                    missing = expected_item_fields - live_items
                    if extra:
                        ep_findings.append(
                            f"  🆕 {arr_name}[]: extra fields: {', '.join(sorted(extra))}"
                        )
                    if missing:
                        ep_findings.append(
                            f"  ❓ {arr_name}[]: missing (may be optional): "
                            f"{', '.join(sorted(missing))}"
                        )

        if ep_findings:
            findings.append({"name": name, "notes": exp["notes"], "issues": ep_findings})
            print(f"\n### {name} ({exp['notes']})")
            for line in ep_findings:
                print(line)

    # ── Summary ──────────────────────────────────────────
    print("\n" + "=" * 90)
    print(f"FINDINGS: {len(findings)} endpoints with mismatches")
    print("=" * 90)

    critical = []
    for f in findings:
        for issue in f["issues"]:
            if "TYPE MISMATCH" in issue:
                critical.append(f"{f['name']}: {issue.strip()}")
            elif "IN TYPES, NOT IN LIVE" in issue:
                critical.append(f"{f['name']}: {issue.strip()}")

    if critical:
        print("\nCRITICAL (type mismatches + fields in types but missing from live):")
        for c in critical:
            print(f"  {c}")

    new_fields = []
    for f in findings:
        for issue in f["issues"]:
            if "IN LIVE, NOT IN TYPES" in issue or "extra fields" in issue:
                new_fields.append(f"{f['name']}: {issue.strip()}")

    if new_fields:
        print("\nNEW FIELDS (in live, not in types — may need adding):")
        for n in new_fields:
            print(f"  {n}")

    # Non-matched endpoints
    unmatched = [e["name"] for e in ok_eps if e["name"] not in EXPECTED_SHAPES]
    if unmatched:
        print(
            f"\nENDPOINTS WITHOUT EXPECTED SHAPE: {', '.join(unmatched)}"
        )


if __name__ == "__main__":
    main()
