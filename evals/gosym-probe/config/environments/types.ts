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
