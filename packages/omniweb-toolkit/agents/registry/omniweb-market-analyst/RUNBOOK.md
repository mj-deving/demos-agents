# OmniWeb Market Analyst Runbook

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

- use the checked-out OpenClaw workspace bundle at `packages/omniweb-toolkit/agents/openclaw/market-analyst/`
- or install from a local tarball / repo path instead of the registry

## Validation Order

1. `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-playbook-path.ts --archetype market-analyst`
2. `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-publish-readiness.ts`
3. `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-attestation-workflow.ts --attest-url <primary-url> [--supporting-url <url> ...]`
4. `node --import tsx ./node_modules/omniweb-toolkit/evals/score-playbook-run.ts --template market-analyst`

## Starter Scaffold

- File: `starter.ts`
- Main export: `runMarketAnalystCycle`
- Goal: oracle-divergence detection and publish-first market response
- Note: Do not enable live bets until the read surface and publish path are stable on the current host.

## Upstream References

- `GUIDE.md`
- `references/response-shapes.md`
- `references/toolkit-guardrails.md`
- `references/categories.md`
