import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// Import from @airo/agents subpath export
import {
  createAssessmentAgent,
  AssessmentReason,
  AssessmentTaskType,
  ClassifierMode,
  MIN_CONFIDENCE_FOR_OVERRIDE,
  type AssessmentAgent,
  type AssessmentOutcome,
  type AssessmentContext,
} from '@airo/agents/assessment-agent';

import type { TestCase, CaseResult, TaskType, ActualPath } from '../corpus/types.js';

import { BaseEvaluator, type EvaluatorConfig, registerEvaluator } from './base-evaluator.js';

/**
 * Map AssessmentReason to ActualPath
 */
function reasonToPath(reason: AssessmentReason): ActualPath {
  switch (reason) {
    case AssessmentReason.EmbeddingCompleted:
    case AssessmentReason.BelowThreshold:
      return 'embedding';
    case AssessmentReason.EmbeddingTimeoutFallback:
      return 'embedding_timeout_fallback';
    case AssessmentReason.InitialPrompt:
      return 'initial_prompt';
    case AssessmentReason.LlmCompleted:
      return 'haiku';
    case AssessmentReason.Timeout:
      return 'timeout';
    case AssessmentReason.Error:
    case AssessmentReason.Disabled:
    case AssessmentReason.EmptyPrompt:
    default:
      return 'error';
  }
}

/**
 * Resolves the classifier mode from MODEL_NAME env var, or prompts the user
 * interactively if the env var is not set.
 */
async function resolveClassifierMode(): Promise<ClassifierMode> {
  const envValue = process.env.MODEL_NAME;

  if (envValue) {
    if (envValue === ClassifierMode.LogisticRegression || envValue === ClassifierMode.CosineSimilarity) {
      return envValue as ClassifierMode;
    }
    throw new Error(
      `Invalid MODEL_NAME: "${envValue}". Must be one of: ${ClassifierMode.LogisticRegression}, ${ClassifierMode.CosineSimilarity}`
    );
  }

  console.log('\nSelect classifier mode (MODEL_NAME env var not set):');
  console.log('  1. logistic-regression');
  console.log('  2. cosine-similarity');

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('\nEnter 1 or 2: ');
  rl.close();

  if (answer.trim() === '1') return ClassifierMode.LogisticRegression;
  if (answer.trim() === '2') return ClassifierMode.CosineSimilarity;

  throw new Error(`Invalid selection: "${answer.trim()}". Enter 1 or 2.`);
}

/**
 * Evaluator for the AssessmentAgent
 */
export class AssessmentEvaluator extends BaseEvaluator {
  private agent: AssessmentAgent | null = null;
  private classifierMode: ClassifierMode | null = null;

  get name(): string {
    return 'Assessment Agent Evaluator';
  }

  get agentType(): string {
    return 'assessment-agent';
  }

  override getModelUsed(): string {
    return this.classifierMode ?? this.config.model ?? 'unknown';
  }

  async initialize(): Promise<void> {
    this.classifierMode = await resolveClassifierMode();
    console.log(`\nUsing classifier mode: ${this.classifierMode}\n`);

    this.agent = createAssessmentAgent({
      timeoutMs: this.config.timeoutMs || 5000,
      confidenceThreshold: this.config.confidenceThreshold ?? MIN_CONFIDENCE_FOR_OVERRIDE,
      enabled: true,
    });

    await this.agent.initialize();
  }

  async cleanup(): Promise<void> {
    this.agent = null;
  }

  async evaluateCase(testCase: TestCase): Promise<CaseResult> {
    if (!this.agent) {
      throw new Error('Evaluator not initialized. Call initialize() first.');
    }

    const startTime = Date.now();

    // Build assessment context
    // Infer isInitialPrompt from "initial" tag if not explicitly set to true
    // Note: default(false) in schema means we check for explicit true OR tag presence
    const isInitialPrompt = testCase.isInitialPrompt === true || testCase.tags.includes('initial');

    const context: AssessmentContext = {
      appId: 'corpus-eval',
      customerId: 'corpus-eval',
      enabledOverride: true,
      previousUserMessage: testCase.previousMessage,
      previousAssessmentTaskType: testCase.previousAssessmentTaskType as AssessmentTaskType | undefined,
      isInitialPrompt,
      classifierMode: this.classifierMode ?? ClassifierMode.CosineSimilarity,
    };

    // Run classification
    let outcome: AssessmentOutcome;
    try {
      outcome = await this.agent.classify(testCase.prompt, context);
    } catch (error) {
      // Handle classification errors
      const latencyMs = Date.now() - startTime;
      return {
        caseId: testCase.id,
        prompt: testCase.prompt,
        previousMessage: testCase.previousMessage,
        expected: {
          taskType: testCase.expectedTaskType,
          path: testCase.expectedPath,
          minConfidence: testCase.minConfidence,
        },
        actual: {
          taskType: 'general' as TaskType,
          confidence: 0,
          path: 'error',
        },
        passed: false,
        failures: [`Classification error: ${error instanceof Error ? error.message : String(error)}`],
        pathWarnings: [],
        latencyMs,
        tags: testCase.tags,
      };
    }

    const latencyMs = Date.now() - startTime;
    const actualPath = reasonToPath(outcome.reason);
    const actualTaskType = (outcome.result?.taskType || 'general') as TaskType;
    const actualConfidence = outcome.result?.confidence || 0;

    // Check classification failures (these count toward accuracy)
    const failures: string[] = [];

    // Check task type
    if (actualTaskType !== testCase.expectedTaskType) {
      failures.push(
        `Task type mismatch: expected "${testCase.expectedTaskType}", got "${actualTaskType}"`
      );
    }

    // Check minimum confidence
    if (actualConfidence < testCase.minConfidence) {
      failures.push(
        `Confidence below threshold: expected >= ${testCase.minConfidence}, got ${actualConfidence}`
      );
    }

    // Check path warnings (these don't count as failures, just tracked separately)
    const pathWarnings: string[] = [];
    if (testCase.expectedPath !== 'any' && actualPath !== testCase.expectedPath) {
      pathWarnings.push(
        `Path mismatch: expected "${testCase.expectedPath}", got "${actualPath}"`
      );
    }

    return {
      caseId: testCase.id,
      prompt: testCase.prompt,
      previousMessage: testCase.previousMessage,
      expected: {
        taskType: testCase.expectedTaskType,
        path: testCase.expectedPath,
        minConfidence: testCase.minConfidence,
      },
      actual: {
        taskType: actualTaskType,
        confidence: actualConfidence,
        path: actualPath,
        reasoning: outcome.result?.reasoning,
      },
      passed: failures.length === 0,
      failures,
      pathWarnings,
      latencyMs,
      tags: testCase.tags,
    };
  }
}

// Register the evaluator
registerEvaluator('assessment-agent', (config) => new AssessmentEvaluator(config));
