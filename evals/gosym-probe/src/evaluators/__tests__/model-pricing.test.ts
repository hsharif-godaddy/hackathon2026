import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICING,
  MODEL_PRICING_LAST_VERIFIED,
} from '../model-pricing.js';

/**
 * Guards the hand-maintained probe pricing table (model-pricing.ts) against the
 * staleness failure mode flagged in review: the table has no live link to the
 * upstream ai-lib pricing source, so these checks are the only thing standing
 * between a malformed/zeroed entry and silently-wrong cost evaluations.
 *
 * Coverage of the *probe* model is asserted here. An unknown probe model is
 * handled at the evaluator layer (probe cost = 0, surfaced in the reason), so
 * the table is allowed to omit models — these tests instead assert that every
 * model it *does* claim to price is priced sanely.
 */
describe('MODEL_PRICING', () => {
  /**
   * Probe (synthetic-user) models the harness is configured to run. Keep this
   * list in sync with the OPENAI_MODEL values used across environments; a model
   * added here without a pricing entry fails the coverage test below, which is
   * the intended early warning.
   */
  const EXPECTED_PROBE_MODELS = [
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-opus-4-6',
    'claude-haiku-4-5',
  ];

  it('prices every expected probe model', () => {
    for (const model of EXPECTED_PROBE_MODELS) {
      expect(
        MODEL_PRICING[model],
        `missing pricing for probe model "${model}"`,
      ).toBeDefined();
    }
  });

  it('has a positive input and output price for every priced model', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputCostPer1K, `${model}.inputCostPer1K`).toBeGreaterThan(0);
      expect(pricing.outputCostPer1K, `${model}.outputCostPer1K`).toBeGreaterThan(0);
    }
  });

  it('prices output at least as high as input for every model', () => {
    // Anthropic prices output tokens above input across the lineup; a flipped
    // pair is the most likely transcription error and would skew the
    // output-cost arm. This is a sanity floor, not an exact-ratio assertion.
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(
        pricing.outputCostPer1K,
        `${model}: output price should be >= input price`,
      ).toBeGreaterThanOrEqual(pricing.inputCostPer1K);
    }
  });

  it('carries an ISO last-verified date', () => {
    expect(MODEL_PRICING_LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
