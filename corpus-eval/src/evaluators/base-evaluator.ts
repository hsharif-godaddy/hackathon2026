import type { TestCase, CaseResult, Corpus } from '../corpus/types.js';

/**
 * Result of running an evaluator
 */
export interface EvaluatorResult {
  /** Whether evaluation completed successfully */
  success: boolean;

  /** Case results if successful */
  results?: CaseResult[];

  /** Error message if failed */
  error?: string;

  /** Total duration in milliseconds */
  duration: number;
}

/** Default concurrency limit to avoid overwhelming APIs */
export const DEFAULT_CONCURRENCY = 5;

/** Default max retries for transient failures */
export const DEFAULT_MAX_RETRIES = 2;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 500;

/**
 * Configuration for an evaluator
 */
export interface EvaluatorConfig {
  /** Model to use for classification */
  model?: string;

  /** Timeout per case in milliseconds */
  timeoutMs?: number;

  /** Whether to enable verbose logging */
  verbose?: boolean;

  /** Confidence threshold for classification (default: 65) */
  confidenceThreshold?: number;

  /** Max concurrent requests (default: 5) */
  concurrency?: number;

  /** Max retries for transient failures (default: 2) */
  maxRetries?: number;
}

/**
 * Check if an error is likely transient and worth retrying
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('502')
    );
  }
  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Base class for all evaluators
 */
export abstract class BaseEvaluator {
  protected config: EvaluatorConfig;

  constructor(config: EvaluatorConfig = {}) {
    this.config = config;
  }

  /** Human-readable name of the evaluator */
  abstract get name(): string;

  /** Agent type this evaluator targets */
  abstract get agentType(): string;

  /**
   * Initialize the evaluator (e.g., create agent instance)
   */
  abstract initialize(): Promise<void>;

  /**
   * Clean up resources
   */
  abstract cleanup(): Promise<void>;

  /**
   * Evaluate a single test case
   */
  abstract evaluateCase(testCase: TestCase): Promise<CaseResult>;

  /**
   * Evaluate a single case with retry logic for transient failures
   */
  private async evaluateCaseWithRetry(testCase: TestCase): Promise<CaseResult> {
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.evaluateCase(testCase);
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const shouldRetry = !isLastAttempt && isTransientError(error);

        if (shouldRetry) {
          const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          if (this.config.verbose) {
            console.log(`    Retry ${attempt + 1}/${maxRetries} for ${testCase.id} after ${delayMs}ms...`);
          }
          await sleep(delayMs);
          continue;
        }

        // Final failure - create error result
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
            taskType: 'general',
            confidence: 0,
            path: 'error',
          },
          passed: false,
          failures: [`Evaluation error: ${error instanceof Error ? error.message : String(error)}`],
          pathWarnings: [],
          latencyMs: 0,
          tags: testCase.tags,
        };
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error('Unexpected: retry loop exited without returning');
  }

  /**
   * Evaluate all test cases in a corpus with controlled concurrency
   */
  async evaluate(corpus: Corpus): Promise<EvaluatorResult> {
    const startTime = Date.now();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;

    try {
      await this.initialize();

      const activeCases = corpus.cases.filter(c => !c.skip);
      const results: CaseResult[] = new Array(activeCases.length);

      // Process cases with controlled concurrency using a pool pattern
      let nextIndex = 0;
      let completedCount = 0;
      let lastProgressTime = Date.now();

      const processNext = async (): Promise<void> => {
        while (nextIndex < activeCases.length) {
          const index = nextIndex++;
          const testCase = activeCases[index];

          const result = await this.evaluateCaseWithRetry(testCase);
          results[index] = result;
          completedCount++;

          if (this.config.verbose) {
            const status = result.passed ? 'PASS' : 'FAIL';
            console.log(`  [${status}] ${testCase.id}: ${result.actual.taskType} (${result.latencyMs}ms)`);
            if (!result.passed) {
              result.failures.forEach(f => console.log(`    - ${f}`));
            }
          } else {
            // Progress indicator: every 50 cases or every 10 seconds
            const now = Date.now();
            if (completedCount % 50 === 0 || now - lastProgressTime > 10000) {
              const elapsed = (now - startTime) / 1000;
              const rate = completedCount / elapsed;
              const remaining = activeCases.length - completedCount;
              const eta = remaining / rate;
              console.log(
                `  Progress: ${completedCount}/${activeCases.length} ` +
                `(${rate.toFixed(1)} cases/sec, ~${eta.toFixed(0)}s remaining)`
              );
              lastProgressTime = now;
            }
          }
        }
      };

      // Start `concurrency` number of workers
      const workers = Array(Math.min(concurrency, activeCases.length))
        .fill(null)
        .map(() => processNext());

      await Promise.all(workers);

      await this.cleanup();

      return {
        success: true,
        results: results.filter(Boolean), // Remove any undefined entries
        duration: Date.now() - startTime,
      };
    } catch (error) {
      await this.cleanup().catch(() => {});

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * Factory function type for creating evaluators
 */
export type EvaluatorFactory = (config: EvaluatorConfig) => BaseEvaluator;

/**
 * Registry of evaluator factories
 */
const evaluatorFactories = new Map<string, EvaluatorFactory>();

/**
 * Register an evaluator factory
 */
export function registerEvaluator(agentType: string, factory: EvaluatorFactory): void {
  evaluatorFactories.set(agentType, factory);
}

/**
 * Create an evaluator for a given agent type
 */
export function createEvaluator(agentType: string, config: EvaluatorConfig = {}): BaseEvaluator {
  const factory = evaluatorFactories.get(agentType);
  if (!factory) {
    const available = Array.from(evaluatorFactories.keys()).join(', ');
    throw new Error(`Unknown evaluator type: ${agentType}. Available: ${available || 'none'}`);
  }
  return factory(config);
}

/**
 * Get list of registered evaluator types
 */
export function getRegisteredEvaluators(): string[] {
  return Array.from(evaluatorFactories.keys());
}
