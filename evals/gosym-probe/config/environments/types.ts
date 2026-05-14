import type { ThresholdConfig } from '../../src/baselines/threshold.js';

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
    model: string;
  };
  eval: {
    defaultTrials: number;
    maxTurns: number;
    turnTimeoutMs: number;
    firstTurnInactivityMs?: number;
    /**
     * Maximum number of retries when the first turn hits an inactivity
     * timeout. Total attempts = maxFirstTurnRetries + 1.
     */
    maxFirstTurnRetries?: number;
    maxConcurrency?: number;
  };
  playwright: {
    ignoreHttpsErrors: boolean;
  };
  regression: ThresholdConfig;
  storage?: {
    maxRuns?: number;
  };
}
