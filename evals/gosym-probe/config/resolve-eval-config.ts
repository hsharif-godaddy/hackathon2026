import type { Config } from './environments/types.js';

export const EVAL_DEFAULTS = {
  firstTurnInactivityMs: 600_000,
  firstTurnRetryScheduleMs: [600_000, 120_000, 120_000, 120_000] as const,
  maxConcurrency: 1,
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

export type ResolvedConfig = Omit<Config, 'eval'> & { eval: ResolvedEvalConfig };
