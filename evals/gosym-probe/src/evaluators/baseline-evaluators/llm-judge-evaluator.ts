import { z } from 'zod';

import type { EvalResult, Evaluator } from '../evaluator.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import { clamp01 } from './shared.js';

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

export const JudgeBooleanSchema = z.object({
  value: z.boolean(),
  verdict: JudgeVerdictSchema,
  reason: z.string().min(1),
});

export const JudgeCategoricalSchema = z.object({
  value: z.string().min(1),
  verdict: JudgeVerdictSchema,
  reason: z.string().min(1),
});

export type JudgeNumerical = z.infer<typeof JudgeNumericalSchema>;
export type JudgeBoolean = z.infer<typeof JudgeBooleanSchema>;
export type JudgeCategorical = z.infer<typeof JudgeCategoricalSchema>;

export interface LLMJudgeEvaluatorConfig<T> {
  name: string;
  evalVersion?: string;
  schema: z.ZodType<T>;
  prompt: (transcript: Transcript, scenario: Scenario, snapshot?: DOMSnapshot) => string | Promise<string>;
  toEvalResult: (
    parsed: T,
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ) => EvalResult;
}

export class LLMJudgeEvaluator<T> implements Evaluator {
  readonly name: string;
  readonly evalVersion?: string;

  constructor(
    private readonly gocode: IGocodeClient,
    private readonly config: LLMJudgeEvaluatorConfig<T>,
  ) {
    this.name = config.name;
    this.evalVersion = config.evalVersion;
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const prompt = await this.config.prompt(transcript, scenario, snapshot);
    let response: string;
    try {
      response = await this.gocode.complete([{ role: 'user', content: prompt }]);
    } catch (err) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: `LLM judge request failed: ${err instanceof Error ? err.message : String(err)}`,
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    const jsonText = extractJsonObject(response);
    if (!jsonText) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Failed to parse LLM judge JSON response',
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
        reason: 'Failed to parse LLM judge JSON response',
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
