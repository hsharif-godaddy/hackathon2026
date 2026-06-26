import type { ThresholdConfig } from '../../src/baselines/threshold.js';
import type { ViewportName } from '../../src/clients/site-capture/types.js';

export interface StatisticalRegressionConfig {
  /** Significance level for TOST (0, 1). Default: 0.05. */
  alpha: number;
  /** SD multiplier for margin computation: margin = k * SD(baseline). Default: 2.0. */
  k: number;
  /** Per-evaluator k overrides. Keys are evaluator names. */
  evaluatorKOverrides?: Record<string, number>;
  /**
   * Non-inferiority margin floor as a fraction of the baseline mean:
   * floorTerm = minMarginFraction * max(mean, 0), and
   * margin = max(k * SD(baseline), floorTerm). When baseline SD is near-zero,
   * k * SD produces a margin too tight for TOST to prove non-inferiority; the
   * fractional floor supplies a minimum tolerance (e.g. 5% of the baseline
   * mean) so sub-threshold jitter is not flagged as a regression. Being a
   * fraction makes it dimensionless and valid across raw-measurement metrics
   * (turns, seconds, steps) whose scales differ by orders of magnitude.
   * Default: 0.05.
   */
  minMarginFraction: number;
  /** Integer PRNG seed for Monte Carlo / bootstrap determinism. */
  seed?: number;
  /** Fallback thresholds used when baseline lacks trialScores (legacy baselines). */
  fallbackThresholds: ThresholdConfig;
}

export interface Config {
  env: string;
  aab: {
    agentsUrl: string;
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
    /**
     * 429 rate-limit retry tuning for every LLM call made through
     * `GocodeClient.complete()` (synthetic user + all LLM evaluators).
     * Optional; `GocodeClient` falls back to built-in defaults
     * (`DEFAULT_RATE_LIMIT_MAX_RETRIES` / `DEFAULT_RATE_LIMIT_WAIT_MS`) when
     * unset. A 429 with a `Retry-After` header always waits the header value
     * (capped in `parseRetryAfterMs`); `waitMs` is the fallback when absent.
     */
    rateLimitRetry?: {
      maxRetries?: number;
      waitMs?: number;
    };
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
  /**
   * Playwright capture-phase tuning. Every field is optional; loadConfig
   * fills unset fields from CAPTURE_DEFAULTS (and the CAPTURE_CONCURRENCY /
   * MAX_ROUTES env vars), so an env config that omits this block behaves
   * exactly as before. `concurrency` bounds how many captures run at once
   * independently of trial concurrency.
   */
  capture?: {
    concurrency?: number;
    /**
     * Hard ceiling for capture concurrency. A requested `concurrency` (config,
     * env var, or `--capture-concurrency` flag) above this is clamped down so a
     * typo can't launch a browser stampede against the single local backend.
     * Filled from CAPTURE_DEFAULTS.maxConcurrency when unset.
     */
    maxConcurrency?: number;
    maxRoutes?: number;
    viewports?: readonly ViewportName[];
    gotoTimeoutMs?: number;
    appReadyTimeoutMs?: number;
  };
  regression: StatisticalRegressionConfig;
  storage?: {
    maxRuns?: number;
  };
}
