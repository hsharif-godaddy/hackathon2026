import { createConfig as createLocalDev } from './environments/local.dev.js';
import { createConfig as createLocalTest } from './environments/local.test.js';
import { createConfig as createLocalProd } from './environments/local.prod.js';
import type { Config } from './environments/types.js';
import {
  parseCaptureConcurrency,
  parseMaxCaptureConcurrency,
  parseMaxRoutes,
} from './environments/parse-env.js';
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

export function loadConfig(): ResolvedConfig {
  const env = process.env.GD_ENV ?? 'local.dev';
  const creator = ENV_CREATORS[env];
  if (!creator) {
    throw new Error(`Unknown GD_ENV: "${env}"`);
  }
  const config = creator();
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
