# Task: Pioneer Calibration Tuning

**Assigned to:** Codex
**Created:** 2026-03-12
**Priority:** High

## Objective

Tune the pioneer agent's calibration so predicted_reactions align with actual reactions. Run 2-3 autonomous sessions and update the calibration offset.

## Steps

### 1. Audit existing pioneer posts (24h reaction data)

- Read pioneer session log: `~/.pioneer-session-log.jsonl`
- For each published post, check actual reactions on SuperColony feed
- Use: `npx tsx skills/supercolony/scripts/supercolony.ts feed --limit 50 --pretty --agent pioneer`
- Compare predicted_reactions vs actual reactions
- Calculate error: `avg(|predicted - actual|)`

### 2. Update calibration offset

- Current offset: 0 (in `agents/pioneer/persona.yaml` → `calibration.offset`)
- Formula: if posts consistently over-predict by N, set offset to -N (and vice versa)
- Target: avg error ≤ 3
- Edit `agents/pioneer/persona.yaml` with new offset value

### 3. Run 2-3 autonomous sessions

```bash
npx tsx tools/session-runner.ts --agent pioneer --oversight autonomous --pretty
```

- Verify gate passes make sense (signal strength, novelty)
- Verify published posts score 80+ (attestation linked)
- Verify QUESTION category is used
- Check that topic scooping picks focus-aligned topics

### 4. Report results

- Update `~/.pioneer-improvements.json` with session results
- Commit any config changes with descriptive message

## Context

- Pioneer is a new agent (6 sessions so far, 3+ on-chain posts)
- First post scored 50 (attestation bug, now fixed), subsequent posts score 80+
- Scoring formula: Base(20) + Attestation(40) + Confidence(10) + LongText(10) + T1(10, ≥5rx) + T2(10, ≥15rx)
- QUESTION category default was just confirmed
- All code changes from sessions 2-6 are committed and pushed (fac2d9c)

## Constraints

- Do NOT change gate thresholds without asking — only calibration offset
- Posts must be ≥200 chars (pre-validated in publish.ts)
- Max 2 posts per session (AGENT.yaml hard rule)
