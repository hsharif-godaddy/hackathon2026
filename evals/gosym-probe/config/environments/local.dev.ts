import type { Config } from './types.js';
import {
  parseMaxConcurrency,
  parseMaxTurns,
} from './parse-env.js';

export function createConfig(): Config {
  return {
    env: 'local.dev',
    aab: {
      socketUrl: 'http://localhost:4000',
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
      maxTurns: parseMaxTurns(30),
      turnTimeoutMs: 1_200_000,
      maxConcurrency: parseMaxConcurrency(2),
    },
    playwright: {
      ignoreHttpsErrors: true,
    },
    regression: {
      thresholds: {
        'bug-hit-rate': 0.1,
        'jtbd-completion': 0.1,
        'tool-call-verification': 0.1,
        'prompt-efficiency': 0.2,
        'token-usage': 1.5,
        'tool-failure-rate': 1.5,
        // Alignment/quality: 15% relative score drop (score-mode evaluators)
        'intent-to-output-alignment': 0.15,
        'implicit-feature-gap': 0.15,
        'scope-drift-overgeneration': 0.15,
        'silent-hallucination': 0.15,
        'output-quality': 0.15,
        'turn-duration': 1.5,
        'llm-cost': 1.5,
        'latency': 1.5,
        'tool-parallelism': 0.5,
        'tool-batching-efficiency': 0.5,
      },
      // Loose gate for score-mode evaluators to absorb infrastructure variance noise
      defaultThreshold: 0.25,
    },
  };
}
