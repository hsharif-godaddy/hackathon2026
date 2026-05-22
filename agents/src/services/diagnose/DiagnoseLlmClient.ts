import { generateTextWithTracking } from '@airo/ai-lib';
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common';

import { Logger } from '../../logging/index.js';
import { getAgentModelWithName } from '../../utils/model-selection.js';
import type { LlmClient, LlmGenerateArgs } from './types.js';

const logger = Logger.create({ component: 'diagnose.llm-client' });

const DEFAULT_MAX_OUTPUT_TOKENS = 3000;

/**
 * Production LlmClient for the diagnose service. Thin adapter that delegates to
 * `@airo/ai-lib` so we inherit provider selection, AI_MODEL_OVERRIDE, DevTools,
 * telemetry, and usage tracking instead of re-implementing them here.
 *
 * Diagnose-specific: hard-codes `temperature: 0`, a 1500-token default ceiling,
 * and the diagnose tool/function identifiers. Not intended as a general-purpose
 * LLM client.
 *
 * We still own the JSON-parse + zod-validate step because ai-lib's current
 * tracking helper returns text only — there's no structured-output wrapper yet.
 */
export class DiagnoseLlmClient implements LlmClient {
  async generateStructured<T>(args: LlmGenerateArgs<T>): Promise<T> {
    const { model, modelName } = await getAgentModelWithName('fast');

    const metadata: LitellmMetadata = {
      user: args.budgetUser,
      tags: args.tags,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs);

    try {
      return await llmMetadataContext.run(metadata, async () => {
        const result = await generateTextWithTracking({
          model,
          modelName,
          system: args.system,
          prompt: args.user,
          temperature: 0,
          maxOutputTokens: args.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          abortSignal: controller.signal,
          context: {
            toolName: args.functionId ?? 'diagnose-service',
            description: 'Diagnose deployment logs',
          },
        });

        return parseAndValidate(result.text, args.schema);
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`LLM call timed out after ${args.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseAndValidate<T>(raw: string, schema: LlmGenerateArgs<T>['schema']): T {
  const candidate = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    logger.warn('diagnose.llm.parse_error', {
      error: error instanceof Error ? error.message : String(error),
      preview: candidate.slice(0, 200),
    });
    throw new Error('LLM response was not valid JSON');
  }

  const validation = schema.safeParse(parsed);
  if (!validation.success) {
    logger.warn('diagnose.llm.schema_error', {
      issues: validation.error.issues.slice(0, 5),
    });
    throw new Error('LLM response did not match expected schema');
  }
  return validation.data;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

