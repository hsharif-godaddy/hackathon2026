import type { Config } from './types.js';
import {
  parseAgentsPort,
  parseMaxConcurrency,
  parseMaxTurns,
  parseTurnTimeoutMs,
} from './parse-env.js';
import { REGRESSION_DEFAULTS, DEV_FALLBACK_THRESHOLDS } from './defaults.js';

export function createConfig(): Config {
  const agentsPort: number = parseAgentsPort(4000);
  return {
    env: 'local.dev',
    aab: {
      // HTTP base URL of the agents server. The AAB client drives chat over SSE
      // (POST conversation + GET stream). Port is overridable via AGENTS_PORT
      // to mirror the agents service's `process.env.PORT || 4000`.
      agentsUrl: `https://local.gasket.dev-godaddy.com:${agentsPort}`,
      bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
      controlPlaneUrl: 'http://localhost:4100',
    },
    gocode: {
      baseUrl: process.env.OPENAI_BASE_URL ?? '',
      apiKey: process.env.PROBE_OPENAI_API_KEY ?? '',
      useS2S: process.env.GOCODE_USE_S2S_AUTH === 'true',
      model: process.env.OPENAI_MODEL ?? '',
      visionModel: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || undefined,
      summaryAnalysisModel: process.env.SUMMARY_ANALYSIS_MODEL || undefined,
    },
    eval: {
      defaultTrials: 1,
      maxTurns: parseMaxTurns(10),
      turnTimeoutMs: parseTurnTimeoutMs(1_200_000),
      maxConcurrency: parseMaxConcurrency(2),
    },
    playwright: {
      ignoreHttpsErrors: true,
    },
    regression: {
      ...REGRESSION_DEFAULTS,
      fallbackThresholds: DEV_FALLBACK_THRESHOLDS,
    },
  };
}
