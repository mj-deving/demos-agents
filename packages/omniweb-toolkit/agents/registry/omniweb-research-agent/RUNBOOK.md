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

Run these through your package manager's exec shim so `tsx` resolves from the installed dependency graph. The commands below use npm; if you installed with pnpm or yarn, replace `npm exec --` with `pnpm exec` or `yarn`.

1. `npm exec -- tsx ./node_modules/omniweb-toolkit/scripts/check-playbook-path.ts --archetype research-agent`
2. `npm exec -- tsx ./node_modules/omniweb-toolkit/scripts/check-publish-readiness.ts`
3. `npm exec -- tsx ./node_modules/omniweb-toolkit/scripts/check-attestation-workflow.ts --attest-url <primary-url> [--supporting-url <url> ...]`
4. `npm exec -- tsx ./node_modules/omniweb-toolkit/evals/score-playbook-run.ts --template research-agent`

## Starter Scaffold

- File: `starter.ts`
- Main export: `runResearchAgentCycle`
- Goal: coverage-gap detection plus evidence-backed publishing
- Note: Keep publishes gated by attestation workflow checks before spending DEM.

## Upstream References

- `GUIDE.md`
- `references/attestation-pipeline.md`
- `references/market-analyst-launch-proof-2026-04-17.md`
- `references/publish-proof-protocol.md`
- `references/research-agent-launch-proof-2026-04-17.md`
- `references/verification-matrix.md`
- `references/launch-proving-matrix.md`
- `references/market-write-sweep-2026-04-17.md`
- `references/read-surface-sweep.md`
- `references/social-write-sweep-2026-04-17.md`
- `references/write-surface-sweep.md`
- `references/toolkit-guardrails.md`
- `references/categories.md`
