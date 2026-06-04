import type { ThresholdConfig } from '../../src/baselines/threshold.js';

export interface StatisticalRegressionConfig {
  /** Significance level for TOST (0, 1). Default: 0.05. */
  alpha: number;
  /** SD multiplier for margin computation: margin = k * SD(baseline). Default: 2.0. */
  k: number;
  /** Per-evaluator k overrides. Keys are evaluator names. */
  evaluatorKOverrides?: Record<string, number>;
  /** Integer PRNG seed for Monte Carlo / bootstrap determinism. */
  seed?: number;
  /** Fallback thresholds used when baseline lacks trialScores (legacy baselines). */
  fallbackThresholds: ThresholdConfig;
}

export interface Config {
  env: string;
  aab: {
    socketUrl: string;
    bffUrl: string;
    controlPlaneUrl: string;
  };
  gocode: {
    baseUrl: string;
    apiKey: string;
    useS2S?: boolean;
    model: string;
    visionModel?: string;
    unicodeSecurityMode?: string;
    piiDetection?: boolean;
  };
  eval: {
    defaultTrials: number;
    maxTurns: number;
    turnTimeoutMs: number;
    firstTurnInactivityMs?: number;
    /**
     * Per-retry inactivity timeout schedule (ms). Retry 1 uses index 0,
     * retry 2 uses index 1, etc. Out-of-bounds falls back to
     * firstTurnInactivityMs. Absent in legacy test configs.
     */
    firstTurnRetryScheduleMs?: readonly number[];
    /**
     * Maximum number of retries when the first turn hits an inactivity
     * timeout. Total attempts = maxFirstTurnRetries + 1.
     * Derived by loadConfig from retrySchedule.length; keep as optional
     * for env configs that rely on EVAL_DEFAULTS.
     */
    maxFirstTurnRetries?: number;
    maxConcurrency?: number;
  };
  playwright: {
    ignoreHttpsErrors: boolean;
  };
  regression: StatisticalRegressionConfig;
  storage?: {
    maxRuns?: number;
  };
}
