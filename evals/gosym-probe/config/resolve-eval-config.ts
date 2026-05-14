import type { Config } from './environments/types.js';

export const EVAL_DEFAULTS = {
  firstTurnInactivityMs: 600_000,
  maxFirstTurnRetries: 2,
  maxConcurrency: 1,
} as const;

export interface ResolvedEvalConfig {
  defaultTrials: number;
  maxTurns: number;
  turnTimeoutMs: number;
  firstTurnInactivityMs: number;
  maxFirstTurnRetries: number;
  maxConcurrency: number;
}

export type ResolvedConfig = Omit<Config, 'eval'> & { eval: ResolvedEvalConfig };
