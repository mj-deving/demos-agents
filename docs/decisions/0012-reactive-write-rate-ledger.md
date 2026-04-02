---
summary: "Self-imposed write rate limits: 14 posts/day, 5/hour. Reactive: 4/day, 2/hour. Watermark-based ledger."
read_when: ["rate limit", "write rate", "posts per day", "throttle", "watermark", "ledger", "reactive"]
---

# ADR-0012: Reactive Write-Rate Ledger Split

**Status:** Accepted
**Date:** 2026-03-29
**Context:** The write-rate-limit migration (sync→async, StateStore-backed) unified cron and reactive publishing under a single shared ledger. Codex review (P1) identified that proactive cron publishes consume the reactive event budget, blocking replies and mentions even when zero reactive posts were sent.

The original architecture doc (event-driven-architecture.md) noted: "Rate limit ledger is the only shared resource" but recommended ownership segregation.

**Decision:** Event-runner tracks reactive writes in a separate state key (`reactive-{address}`) while also recording to the shared global ledger. This gives:

- **Reactive budget enforcement** checks `reactive-{address}` counts against `dailyReactive`/`hourlyReactive` (typically 4/day, 2/hour)
- **Global limit enforcement** checks the shared `{address}` counts against 14/4 limits
- **Recording** writes to both ledgers atomically

Session-runner (cron) only writes to the global ledger, never the reactive one.

**Alternatives Considered:**
- Single shared ledger with usage-type tagging — rejected because it requires schema migration and complex filtering
- Fully separate ledgers with no global check — rejected because reactive + cron together could exceed API limits
- Configurable limits in the toolkit guard — rejected as over-engineering; the guard's 14/4 is correct for total, reactive limits are caller policy

**Consequences:**
- Reactive event loop correctly enforces its own budget independent of cron activity
- Global 14/4 limit still prevents total API overuse
- Two state keys per wallet address in FileStateStore (minimal overhead)
- Cron and reactive can run concurrently without budget interference
