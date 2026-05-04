import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPromptBuilder } from '@airo/ai-lib';
import { BudgetOverride } from '@airo/ai-grants';

import type { SanitizedLogEntry } from '../../log-sanitizer.js';
import { Logger } from '../../../logging/index.js';
import {
  LlmAnalysisSchema,
  type AppContext,
  type Classifier,
  type ClassifierResult,
  type ClassifierSource,
  type Issue,
  type LlmAnalysisOutput,
  type LlmClient,
} from '../types.js';

export interface LlmClassifierOptions {
  /** Hard timeout for the LLM call in ms (default 30_000). */
  timeoutMs?: number;
  /** Absolute path to the directory containing diagnose prompt files. Defaults to `agents/src/prompts/`. */
  promptsRoot?: string;
  /** Override function that yields the absolute path to a prompt file (for unit tests). Takes precedence over promptsRoot. */
  resolvePromptPath?: (relativePath: string) => string;
  /** Override file reader (for unit tests). */
  readFile?: (absPath: string) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DIAGNOSE_TAG = 'source:diagnose';
const FUNCTION_ID = 'diagnose-service-tier3';

const logger = Logger.create({ component: 'diagnose.llm-classifier' });

/**
 * Tier 3 classifier: composes the diagnose prompt from modular markdown fragments and
 * delegates to an LlmClient. Always returns handled=true so the orchestrator can stop
 * after this tier — a failure is still an (unknown) answer, not a pass-through.
 */
export class LlmClassifier implements Classifier {
  readonly source: ClassifierSource = 'llm';

  private readonly timeoutMs: number;
  private readonly resolvePromptPath: (relativePath: string) => string;
  private readonly readPromptFile: (absPath: string) => Promise<string>;
  private cachedSystemPrompt: string | null = null;

  constructor(
    private readonly llm: LlmClient,
    options: LlmClassifierOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const promptsRoot = options.promptsRoot ?? DEFAULT_PROMPTS_ROOT;
    this.resolvePromptPath = options.resolvePromptPath ?? ((rel) => path.resolve(promptsRoot, rel));
    this.readPromptFile = options.readFile ?? ((p) => readFile(p, 'utf-8'));
  }

  async classify(logs: SanitizedLogEntry[], context: AppContext): Promise<ClassifierResult> {
    if (logs.length === 0) {
      return {
        handled: true,
        issues: [
          {
            id: 'no-logs',
            category: 'Unknown',
            severity: 'warning',
            message: 'No logs were returned from the container; nothing to analyze.',
            recommendation:
              'Wait for more deployment output or re-run with a longer `lines` value, then retry.',
            confidence: 20,
            source: this.source,
          },
        ],
      };
    }

    try {
      const systemPrompt = await this.loadSystemPrompt();
      const userPrompt = await this.buildUserPrompt(context, logs);
      const output = await this.llm.generateStructured<LlmAnalysisOutput>({
        system: systemPrompt,
        user: userPrompt,
        schema: LlmAnalysisSchema,
        timeoutMs: this.timeoutMs,
        budgetUser: BudgetOverride.DiagnoseTask,
        tags: [DIAGNOSE_TAG, `target:${context.target}`],
        functionId: FUNCTION_ID,
      });
      return {
        handled: true,
        issues: output.issues.map((i) => this.stampIssue(i)),
        status: output.status,
        primaryRecommendation: output.primaryRecommendation,
      };
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno?.code === 'ENOENT') {
        logger.error('diagnose.tier.llm.prompt_missing', {
          appId: context.appId,
          path: errno.path,
          error: errno.message,
        });
        return {
          handled: true,
          issues: [
            {
              id: 'llm-prompt-missing',
              category: 'Analyzer Unavailable',
              severity: 'warning',
              message: 'Unable to analyze logs — an analyzer prompt file is missing.',
              recommendation:
                'This is a platform configuration error — retrying will not help. Contact support.',
              confidence: 0,
              source: this.source,
            },
          ],
        };
      }
      logger.warn('diagnose.tier.llm.failure', {
        appId: context.appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        handled: true,
        issues: [
          {
            id: 'llm-failure',
            category: 'Analyzer Unavailable',
            severity: 'warning',
            message: 'Unable to analyze logs automatically — the LLM tier failed.',
            recommendation:
              'Review the raw logs manually or retry the analysis in a few moments.',
            confidence: 0,
            source: this.source,
          },
        ],
      };
    }
  }

  private async loadSystemPrompt(): Promise<string> {
    if (this.cachedSystemPrompt) return this.cachedSystemPrompt;

    const [systemTemplate, buildReq, runtimeReq, healthReq, depsReq, outputSchema] =
      await Promise.all([
        this.readPromptFile(this.resolvePromptPath('diagnose/system.md')),
        this.readPromptFile(this.resolvePromptPath('diagnose/requirements/build.md')),
        this.readPromptFile(this.resolvePromptPath('diagnose/requirements/runtime.md')),
        this.readPromptFile(this.resolvePromptPath('diagnose/requirements/health.md')),
        this.readPromptFile(this.resolvePromptPath('diagnose/requirements/deps.md')),
        this.readPromptFile(this.resolvePromptPath('diagnose/output-schema.md')),
      ]);

    const composed = await createPromptBuilder()
      .template(systemTemplate)
      .build({
        BuildRequirements: buildReq,
        RuntimeRequirements: runtimeReq,
        HealthRequirements: healthReq,
        DependencyRequirements: depsReq,
        OutputSchema: outputSchema,
      });

    this.cachedSystemPrompt = composed;
    return composed;
  }

  private async buildUserPrompt(ctx: AppContext, logs: SanitizedLogEntry[]): Promise<string> {
    const userTemplate = await this.readPromptFile(this.resolvePromptPath('diagnose/user.md'));
    const logText = logs
      .map((entry) => `${entry.timestamp} [${entry.source}] ${entry.message}`)
      .join('\n');

    return createPromptBuilder()
      .template(userTemplate)
      .build({
        appId: ctx.appId,
        target: ctx.target,
        logCount: logs.length,
        logs: logText,
      });
  }

  private stampIssue(raw: LlmAnalysisOutput['issues'][number]): Issue {
    return { ...raw, source: this.source };
  }
}

// Default prompts root: walk up from `agents/src/services/diagnose/classifiers/` to
// `agents/src/prompts/`. Callers can override via `LlmClassifierOptions.promptsRoot`.
const DEFAULT_PROMPTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'prompts'
);
