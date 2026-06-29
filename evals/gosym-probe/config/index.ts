import { createConfig as createLocalDev } from './environments/local.dev.js';
import { createConfig as createLocalTest } from './environments/local.test.js';
import { createConfig as createLocalProd } from './environments/local.prod.js';
import type { Config, StatisticalRegressionConfig } from './environments/types.js';
import {
  parseCaptureConcurrency,
  parseMaxCaptureConcurrency,
  parseMaxRoutes,
} from './environments/parse-env.js';
import { warnLine } from '../src/util/warn-line.js';
import { CAPTURE_DEFAULTS, EVAL_DEFAULTS } from './resolve-eval-config.js';
import type { ResolvedCaptureConfig, ResolvedConfig } from './resolve-eval-config.js';

export type { Config, ResolvedConfig };

const ENV_CREATORS: Record<string, () => Config> = {
  'local.dev': createLocalDev,
  'local.test': createLocalTest,
  'local.prod': createLocalProd,
};

/**
 * Resolves the capture block. Precedence (lowest to highest):
 * CAPTURE_DEFAULTS → env-config `capture` overrides → CAPTURE_CONCURRENCY /
 * MAX_ROUTES env vars. The two env vars win last so an operator can raise
 * capture parallelism or trim route depth without editing config files.
 */
export function resolveCaptureConfig(config: Config): ResolvedCaptureConfig {
  const fromConfig = config.capture ?? {};
  return {
    concurrency: parseCaptureConcurrency(
      fromConfig.concurrency ?? CAPTURE_DEFAULTS.concurrency,
    ),
    maxConcurrency: parseMaxCaptureConcurrency(
      fromConfig.maxConcurrency ?? CAPTURE_DEFAULTS.maxConcurrency,
    ),
    maxRoutes: parseMaxRoutes(
      fromConfig.maxRoutes ?? CAPTURE_DEFAULTS.maxRoutes,
    ),
    // Guard against an empty array silently disabling capture: an explicit
    // `viewports: []` falls back to the default rather than capturing nothing.
    viewports:
      fromConfig.viewports && fromConfig.viewports.length > 0
        ? fromConfig.viewports
        : CAPTURE_DEFAULTS.viewports,
    gotoTimeoutMs: fromConfig.gotoTimeoutMs ?? CAPTURE_DEFAULTS.gotoTimeoutMs,
    appReadyTimeoutMs:
      fromConfig.appReadyTimeoutMs ?? CAPTURE_DEFAULTS.appReadyTimeoutMs,
  };
}

/**
 * One-time operator-facing validation of the configured reporting vectors. A
 * reporting `k` is only meaningful as a positive integer; `resolveReportingKs`
 * (the math boundary) silently drops anything else, so a misconfigured env
 * would otherwise degrade reporting with no signal. This emits a single warning
 * naming the offending values and their source key. It never throws or mutates
 * the config — the math boundary remains the enforcement point.
 */
export function validateReportingK(regression: StatisticalRegressionConfig): void {
  const isInvalid = (value: number): boolean => !Number.isInteger(value) || value < 1;
  const offenders: { key: string; values: number[] }[] = [];

  const baseInvalid: number[] = regression.reportingK.filter(isInvalid);
  if (baseInvalid.length > 0) {
    offenders.push({ key: 'regression.reportingK', values: baseInvalid });
  }

  const overrides: Record<string, number[]> = regression.reportingKOverrides ?? {};
  for (const [evaluator, vector] of Object.entries(overrides)) {
    const overrideInvalid: number[] = vector.filter(isInvalid);
    if (overrideInvalid.length > 0) {
      offenders.push({
        key: `regression.reportingKOverrides.${evaluator}`,
        values: overrideInvalid,
      });
    }
  }

  if (offenders.length > 0) {
    warnLine(
      'config.reportingK.invalid: reporting-vector entries must be positive integers; invalid entries will be dropped by resolveReportingKs.',
      { offenders },
    );
  }
}

export function loadConfig(): ResolvedConfig {
  const env = process.env.GD_ENV ?? 'local.dev';
  const creator = ENV_CREATORS[env];
  if (!creator) {
    throw new Error(`Unknown GD_ENV: "${env}"`);
  }
  const config = creator();
  validateReportingK(config.regression);
  const retrySchedule =
    config.eval.firstTurnRetryScheduleMs ?? EVAL_DEFAULTS.firstTurnRetryScheduleMs;
  return {
    ...config,
    eval: {
      ...EVAL_DEFAULTS,
      ...config.eval,
      maxFirstTurnRetries: retrySchedule.length,
      firstTurnRetryScheduleMs: retrySchedule,
    },
    capture: resolveCaptureConfig(config),
  };
}
