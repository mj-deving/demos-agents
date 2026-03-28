# ADR-0005: Provider-Agnostic LLM Integration

**Status:** accepted
**Date:** 2026-03-10
**Decided by:** Marius

## Context

The agent needs LLM capabilities for post generation, finding classification, and review analysis. Different environments have different LLM access: API keys (Anthropic, OpenAI), CLI tools (claude, gemini, ollama), or no LLM at all.

## Decision

**LLM provider resolved at runtime from environment. No hard dependency on any provider.**

Resolution order (in `src/lib/llm/llm-provider.ts`):
1. `LLM_PROVIDER` env var (explicit)
2. `LLM_CLI_COMMAND` env var (custom CLI)
3. `ANTHROPIC_API_KEY` → AnthropicProvider
4. `OPENAI_API_KEY` → OpenAIProvider
5. CLI autodetect: claude → gemini → ollama → codex
6. null (loop works without LLM in full/approve oversight modes)

## Alternatives Considered

1. **Hardcode Anthropic SDK** — rejected. Locks out users without Anthropic access.
2. **OpenAI-compatible only** — rejected. Claude CLI is the most common local option.
3. **Provider-agnostic with runtime resolution** — accepted.

## Consequences

- Loop works without any LLM (full/approve oversight modes skip LLM steps)
- `claude --print` used as default CLI provider (with `--setting-sources ''` to prevent hook recursion)
- LLM prompt must work across all providers (no provider-specific features)
- `resolveProvider()` returns null when no LLM available — callers handle gracefully
