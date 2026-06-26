import type { StatisticalRegressionConfig } from './types.js';

/**
 * Statistical parameters shared across all environments.
 * Spread into per-env regression configs; individual fields can be overridden.
 */
export const REGRESSION_DEFAULTS: Pick<StatisticalRegressionConfig, 'alpha' | 'k' | 'minMarginFraction'> = {
  alpha: 0.05,
  k: 2.0,
  minMarginFraction: 0.05,
};

/**
 * Fallback thresholds for dev and test environments.
 * Prod uses tighter thresholds and a lower defaultThreshold.
 */
export const DEV_FALLBACK_THRESHOLDS: StatisticalRegressionConfig['fallbackThresholds'] = {
  thresholds: {
    'bug-hit-rate': 0.1,
    'jtbd-completion': 0.1,
    'tool-call-verification': 0.1,
    'token-usage': 1.5,
    'tool-failure-rate': 1.5,
    'intent-to-output-alignment': 0.15,
    'implicit-feature-gap': 0.15,
    'scope-drift-overgeneration': 0.15,
    'silent-hallucination': 0.15,
    'output-quality': 0.15,
    'turn-duration': 1.5,
    'llm-cost': 1.5,
    'latency': 1.5,
    'tool-parallelism': 0.5,
    'tool-batching-efficiency': 0.5,
  },
  // Fallback gate for legacy baselines lacking trialScores
  defaultThreshold: 0.25,
};
