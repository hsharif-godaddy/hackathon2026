import type { Config } from './environments/types.js';
import type { ViewportName } from '../src/clients/site-capture/types.js';

export const EVAL_DEFAULTS = {
  firstTurnInactivityMs: 600_000,
  firstTurnRetryScheduleMs: [600_000, 120_000, 120_000, 120_000] as const,
  maxConcurrency: 1,
} as const;

/**
 * Capture-phase defaults. Values equal the constants previously hardcoded in
 * the capture path (capture.ts goto/app-ready timeouts, routes.ts MAX_ROUTES,
 * types.ts VIEWPORT_ORDER) so an unconfigured run is byte-for-byte unchanged.
 * `concurrency` defaults to 2: the prior de-facto ceiling, now decoupled from
 * trial concurrency. `maxConcurrency` is a sanity ceiling so a runaway
 * override (e.g. a `--capture-concurrency 100` typo) can't launch a browser
 * stampede against the single local backend; it is not a per-run default.
 */
export const CAPTURE_DEFAULTS = {
  concurrency: 2,
  maxConcurrency: 8,
  maxRoutes: 20,
  viewports: ['mobile', 'laptop'] as readonly ViewportName[],
  gotoTimeoutMs: 30_000,
  appReadyTimeoutMs: 15_000,
} as const;

export interface ResolvedEvalConfig {
  defaultTrials: number;
  maxTurns: number;
  turnTimeoutMs: number;
  firstTurnInactivityMs: number;
  firstTurnRetryScheduleMs: readonly number[];
  maxFirstTurnRetries: number;
  maxConcurrency: number;
}

export interface ResolvedCaptureConfig {
  concurrency: number;
  maxConcurrency: number;
  maxRoutes: number;
  viewports: readonly ViewportName[];
  gotoTimeoutMs: number;
  appReadyTimeoutMs: number;
}

export type ResolvedConfig =
  & Omit<Config, 'eval' | 'capture'>
  & { eval: ResolvedEvalConfig; capture: ResolvedCaptureConfig };
