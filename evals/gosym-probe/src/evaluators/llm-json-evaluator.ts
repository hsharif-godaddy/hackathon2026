import { z } from 'zod';
import { RateLimitError } from 'openai';

import type { EvalResult, Evaluator } from './evaluator.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { clamp01 } from './shared.js';
import { retryOn429 } from '../util/retry-on-429.js';
import { warnLine } from '../util/warn-line.js';

const EVALUATOR_RATE_LIMIT_MAX_RETRIES = 5;
const EVALUATOR_RATE_LIMIT_WAIT_MS = 30_000;

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export const JudgeVerdictSchema = z.enum([
  'pass',
  'partial',
  'fail',
  'unknown',
]);

export const JudgeNumericalSchema = z.object({
  score: z.number().min(0).max(1),
  verdict: JudgeVerdictSchema,
  reason: z.string().min(1),
});

export type JudgeNumerical = z.infer<typeof JudgeNumericalSchema>;

export interface LLMJsonEvaluatorConfig<T> {
  name: string;
  evalVersion?: string;
  regressionMode?: 'passRate' | 'score';
  lowerIsBetter?: boolean;
  schema: z.ZodType<T>;
  canEvaluate?: (transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => boolean | Promise<boolean>;
  validateEvidence?: (transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => Promise<boolean>;
  prompt: (transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => string | Promise<string>;
  toEvalResult: (
    parsed: T,
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ) => EvalResult;
}

export class LLMJsonEvaluator<T> implements Evaluator {
  readonly name: string;
  readonly evalVersion?: string;
  readonly regressionMode?: 'passRate' | 'score';
  readonly lowerIsBetter?: boolean;

  constructor(
    private readonly gocode: IGocodeClient,
    private readonly config: LLMJsonEvaluatorConfig<T>,
  ) {
    this.name = config.name;
    this.evalVersion = config.evalVersion;
    this.regressionMode = config.regressionMode;
    this.lowerIsBetter = config.lowerIsBetter;
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    if (this.config.canEvaluate && !await this.config.canEvaluate(transcript, scenario, snapshot)) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Insufficient evidence to evaluate (no DOM snapshot)',
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    if (this.config.validateEvidence &&
        !await this.config.validateEvidence(transcript, scenario, snapshot)) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Evidence validation failed (snapshot unreadable or empty)',
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    const prompt = await this.config.prompt(transcript, scenario, snapshot);
    let response: string;
    try {
      response = await retryOn429(
        () => this.gocode.complete([{ role: 'user', content: prompt }]),
        {
          maxRetries: EVALUATOR_RATE_LIMIT_MAX_RETRIES,
          defaultWaitMs: EVALUATOR_RATE_LIMIT_WAIT_MS,
          onRetry: ({ attempt, maxRetries, waitMs }) => {
            warnLine('LLM judge rate-limited; retrying.', {
              evaluator: this.name,
              attempt,
              maxAttempts: maxRetries,
              waitSeconds: waitMs / 1000,
            });
          },
          onExhausted: (totalAttempts) => {
            warnLine('LLM judge rate-limit retry budget exhausted.', {
              evaluator: this.name,
              totalAttempts,
            });
          },
        },
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      warnLine('LLM judge request failed.', {
        evaluator: this.name,
        error: errorMessage,
        isRateLimit: err instanceof RateLimitError,
      });
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: `LLM judge request failed: ${errorMessage}`,
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    const jsonText = extractJsonObject(response);
    if (!jsonText) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No JSON object found in LLM judge response',
        details: { response: response.slice(0, 800) },
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(jsonText);
    } catch {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'LLM judge response contained malformed JSON',
        details: { response: response.slice(0, 800) },
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    const parsed = this.config.schema.safeParse(parsedUnknown);
    if (!parsed.success) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'LLM judge response did not match expected schema',
        details: {
          issues: parsed.error.issues,
          response: response.slice(0, 800),
        },
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    const result = this.config.toEvalResult(parsed.data, transcript, scenario, snapshot);
    return {
      ...result,
      score: clamp01(result.score),
      ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
    };
  }
}
