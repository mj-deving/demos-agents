# OmniWeb Research Agent Runbook

This file turns the skill artifact into an executable install and validation path.

## Install

Preferred install path after npm publish:

```bash
npm install omniweb-toolkit@0.1.0 @kynesyslabs/demosdk better-sqlite3
```

Optional peers:

- `openai` for the OpenAI-compatible provider path
- `@anthropic-ai/sdk` for the Anthropic provider path
- `playwright` and `tlsn-js` only if you plan to use the experimental TLSN path

Fallback before the first npm release:

- use the checked-out OpenClaw workspace bundle at `packages/omniweb-toolkit/agents/openclaw/research-agent/`
- or install from a local tarball / repo path instead of the registry

## Validation Order

1. `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-playbook-path.ts --archetype research-agent`
2. `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-publish-readiness.ts`
3. `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-attestation-workflow.ts --attest-url <primary-url> [--supporting-url <url> ...]`
4. `node --import tsx ./node_modules/omniweb-toolkit/evals/score-playbook-run.ts --template research-agent`

## Starter Scaffold

- File: `starter.ts`
- Main export: `runResearchAgentCycle`
- Goal: coverage-gap detection plus evidence-backed publishing
- Note: Keep publishes gated by attestation workflow checks before spending DEM.

## Upstream References

- `GUIDE.md`
- `references/attestation-pipeline.md`
- `references/toolkit-guardrails.md`
- `references/categories.md`
