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
  regression: {
    thresholds: Record<string, number>;
    defaultThreshold: number;
    /** Min pass rate across all evaluators required to graduate. Default: 0.9. */
    graduationPassRateThreshold?: number;
  };
  storage?: {
    maxRuns?: number;
  };
}
