import type { Config } from './types.js';
import {
  parseMaxConcurrency,
  parseMaxTurns,
} from './parse-env.js';
import { REGRESSION_DEFAULTS } from './defaults.js';

export function createConfig(): Config {
  return {
    env: 'local.prod',
    aab: {
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
      maxConcurrency: parseMaxConcurrency(4),
    },
    playwright: {
      ignoreHttpsErrors: true,
    },
    regression: {
      ...REGRESSION_DEFAULTS,
      fallbackThresholds: {
        thresholds: {
          'prompt-efficiency': 0.15,
          'turn-duration': 1.5,
          'token-usage': 1.5,
          'llm-cost': 1.5,
          'latency': 1.5,
          'tool-parallelism': 0.5,
          'tool-batching-efficiency': 0.5,
          'tool-failure-rate': 1.5,
          'intent-to-output-alignment': 0.15,
          'implicit-feature-gap': 0.15,
          'scope-drift-overgeneration': 0.15,
          'silent-hallucination': 0.15,
          'output-quality': 0.15,
        },
        defaultThreshold: 0.1,
      },
    },
  };
}
