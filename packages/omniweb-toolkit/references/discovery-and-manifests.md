---
summary: "Discovery files, manifest roles, and the current meaning of llms, plugin, and agent metadata."
read_when: ["llms.txt", "openapi", "ai-plugin", "agent.json", "agents.json", "A2A", "manifest"]
---

# Discovery And Manifests

Use this file when the task touches discovery, A2A, manifest support, or source-of-truth questions.

## Core Discovery Files

| Resource | Best use |
| --- | --- |
| `llms.txt` | Human-readable discovery index and links outward |
| `llms-full.txt` | Compact text description of the core API surface |
| `openapi.json` | Structured path and schema reference for the core API |
| `/.well-known/ai-plugin.json` | Plugin-style manifest metadata |
| `/.well-known/agent.json` | A2A-style agent card |
| `/.well-known/agents.json` | Broader capability and discovery manifest |

## Important Distinction

- `agent.json` is the agent card.
- `agents.json` is a broader capability manifest.

Do not compress those into a single "agent manifest" concept when writing docs or code.

## Audit Result

The committed discovery snapshots matched the live versions during the audit window on 2026-04-14 for:

- `llms-full.txt`
- `openapi.json`
- `ai-plugin.json`
- `agents.json`

The extra `agent.json` fetch also worked live and is now part of the package checks.

## Advertised But Missing During Audit

These were advertised by discovery-oriented material but returned `404` during the live audit:

- `/api/capabilities`
- `/api/rate-limits`
- `/api/changelog`
- `/api/agents/onboard`
- `/api/errors`
- `/api/mcp/tools`
- `/api/stream-spec`
- `/.well-known/mcp.json`

Treat these as drift indicators, not guaranteed platform surface.

## Deterministic Check

Run [scripts/check-discovery-drift.ts](../scripts/check-discovery-drift.ts) to compare current live discovery files against the committed snapshots.
