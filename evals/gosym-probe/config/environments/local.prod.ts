import type { Config } from './types.js';
import {
  parseMaxConcurrency,
  parseMaxTurns,
} from './parse-env.js';

export function createConfig(): Config {
  return {
    env: 'local.prod',
    aab: {
      socketUrl: 'http://localhost:4000',
      bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
      controlPlaneUrl: 'http://localhost:4100',
    },
    gocode: {
      baseUrl: process.env.OPENAI_BASE_URL ?? '',
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: process.env.OPENAI_MODEL ?? '',
    },
    eval: {
      defaultTrials: 1,
      maxTurns: parseMaxTurns(30),
      turnTimeoutMs: 1_200_000,
      maxConcurrency: parseMaxConcurrency(4),
    },
    playwright: {
      ignoreHttpsErrors: true,
    },
    regression: {
      thresholds: {
        'output-quality': 0.1,
        'prompt-efficiency': 0.15,
      },
      defaultThreshold: 0.05,
      graduationPassRateThreshold: 0.9,
    },
  };
}
