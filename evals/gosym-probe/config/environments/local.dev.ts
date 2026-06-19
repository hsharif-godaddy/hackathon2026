import type { Config } from './types.js';
import {
  parseMaxConcurrency,
  parseMaxTurns,
} from './parse-env.js';
import { REGRESSION_DEFAULTS, DEV_FALLBACK_THRESHOLDS } from './defaults.js';

export function createConfig(): Config {
  return {
    env: 'local.dev',
    aab: {
      // HTTP base URL of the agents server. The AAB client drives chat over SSE
      // (POST conversation + GET stream).
      agentsUrl: 'https://local.gasket.dev-godaddy.com:4000',
      bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
      controlPlaneUrl: 'http://localhost:4100',
    },
    gocode: {
      baseUrl: process.env.OPENAI_BASE_URL ?? '',
      apiKey: process.env.PROBE_OPENAI_API_KEY ?? '',
      useS2S: process.env.GOCODE_USE_S2S_AUTH === 'true',
      model: process.env.OPENAI_MODEL ?? '',
      visionModel: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || undefined,
    },
    eval: {
      defaultTrials: 1,
      maxTurns: parseMaxTurns(10),
      turnTimeoutMs: 1_200_000,
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
