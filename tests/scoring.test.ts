/**
 * Scoring formula tests — verifies the on-chain scoring model
 * documented in CLAUDE.md is correctly encoded in scoring.ts.
 *
 * These tests ensure the scoring constants don't drift from
 * the verified formula (n=34, confirmed 2026-03-14).
 */

import { describe, it, expect } from "vitest";
import {
  SCORE_BASE,
  SCORE_ATTESTATION,
  SCORE_CONFIDENCE,
  SCORE_LONG_TEXT,
  SCORE_ENGAGEMENT_T1,
  SCORE_ENGAGEMENT_T2,
  SCORE_MAX,
  ENGAGEMENT_T1_THRESHOLD,
  ENGAGEMENT_T2_THRESHOLD,
  LONG_TEXT_MIN_CHARS,
  calculateExpectedScore,
} from "../tools/lib/scoring.js";

describe("scoring constants", () => {
  it("component scores sum to max", () => {
    const sum = SCORE_BASE + SCORE_ATTESTATION + SCORE_CONFIDENCE +
      SCORE_LONG_TEXT + SCORE_ENGAGEMENT_T1 + SCORE_ENGAGEMENT_T2;
    expect(sum).toBe(SCORE_MAX);
  });

  it("base score is 20", () => {
    expect(SCORE_BASE).toBe(20);
  });

  it("attestation bonus is 40", () => {
    expect(SCORE_ATTESTATION).toBe(40);
  });

  it("confidence bonus is 5", () => {
    expect(SCORE_CONFIDENCE).toBe(5);
  });

  it("long text bonus is 15", () => {
    expect(SCORE_LONG_TEXT).toBe(15);
  });

  it("engagement T1 threshold is 5 reactions", () => {
    expect(ENGAGEMENT_T1_THRESHOLD).toBe(5);
  });

  it("engagement T2 threshold is 15 reactions", () => {
    expect(ENGAGEMENT_T2_THRESHOLD).toBe(15);
  });

  it("long text minimum is 200 chars", () => {
    expect(LONG_TEXT_MIN_CHARS).toBe(200);
  });
});

describe("calculateExpectedScore", () => {
  it("base-only post scores 20", () => {
    expect(calculateExpectedScore({
      hasAttestation: false,
      hasConfidence: false,
      textLength: 50,
      reactions: 0,
    })).toBe(20);
  });

  it("attested post scores 60 (base + attestation)", () => {
    expect(calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: false,
      textLength: 50,
      reactions: 0,
    })).toBe(60);
  });

  it("typical published post scores 80 (base + attestation + confidence + long text)", () => {
    expect(calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: true,
      textLength: 300,
      reactions: 0,
    })).toBe(80);
  });

  it("post with 5+ reactions scores 90", () => {
    expect(calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: true,
      textLength: 300,
      reactions: 5,
    })).toBe(90);
  });

  it("post with 15+ reactions scores 100 (max)", () => {
    expect(calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: true,
      textLength: 300,
      reactions: 15,
    })).toBe(100);
  });

  it("never exceeds SCORE_MAX", () => {
    expect(calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: true,
      textLength: 1000,
      reactions: 100,
    })).toBe(100);
  });

  it("text at exactly 200 chars gets long text bonus", () => {
    const withBonus = calculateExpectedScore({
      hasAttestation: false, hasConfidence: false, textLength: 200, reactions: 0,
    });
    const without = calculateExpectedScore({
      hasAttestation: false, hasConfidence: false, textLength: 199, reactions: 0,
    });
    expect(withBonus - without).toBe(SCORE_LONG_TEXT);
  });

  it("reactions at exactly 5 gets T1 bonus", () => {
    const with5 = calculateExpectedScore({
      hasAttestation: false, hasConfidence: false, textLength: 50, reactions: 5,
    });
    const with4 = calculateExpectedScore({
      hasAttestation: false, hasConfidence: false, textLength: 50, reactions: 4,
    });
    expect(with5 - with4).toBe(SCORE_ENGAGEMENT_T1);
  });
});
