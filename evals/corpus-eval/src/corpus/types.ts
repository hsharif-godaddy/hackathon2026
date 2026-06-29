import { z } from 'zod';
import { ConversationRole, FixSessionPhase } from '@airo/agents/assessment-agent';

/**
 * Task types that can be classified by the assessment agent
 */
export const TaskTypeSchema = z.enum(['publish', 'domain', 'fix', 'general']);
export type TaskType = z.infer<typeof TaskTypeSchema>;

/**
 * Expected classification path (embedding fast-path vs LLM fallback vs initial prompt bypass)
 */
export const ExpectedPathSchema = z.enum(['embedding', 'haiku', 'initial_prompt', 'any']);
export type ExpectedPath = z.infer<typeof ExpectedPathSchema>;

/**
 * A single test case in the corpus
 */
export const TestCaseSchema = z.object({
  /** Unique identifier for the test case */
  id: z.string(),

  /** The user prompt to classify */
  prompt: z.string(),

  /** Expected task type classification */
  expectedTaskType: TaskTypeSchema,

  /** Expected classification path (optional, defaults to 'any') */
  expectedPath: ExpectedPathSchema.optional().default('any'),

  /** Minimum confidence threshold (optional, defaults to 0) */
  minConfidence: z.number().min(0).max(100).optional().default(0),

  /** Tags for filtering and analysis */
  tags: z.array(z.string()).optional().default([]),

  /** Previous message for multi-turn context (optional) */
  previousMessage: z.string().optional(),

  /** Previous assessment task type for session context gating (optional) */
  previousAssessmentTaskType: TaskTypeSchema.optional(),

  /**
   * Mark as initial prompt (first message for a new app).
   * When true, AssessmentAgent returns 'general' immediately without classification.
   * Use this for test cases that simulate the first user message in app creation.
   */
  isInitialPrompt: z.boolean().optional().default(false),

  /** Whether a fix session is active for this test case (optional) */
  fixSessionActive: z.boolean().optional(),

  /** Fix session phase (optional, requires fixSessionActive) */
  fixSessionPhase: z.enum([FixSessionPhase.Gathering, FixSessionPhase.Attempted]).optional(),

  /** Recent conversation turns for expanded Haiku context (optional, max 6) */
  recentTurns: z.array(z.object({ role: z.enum([ConversationRole.user, ConversationRole.agent]), content: z.string() })).max(6).optional(),

  /** Whether the agent's last turn explicitly asked a question (optional) */
  lastTurnAgentAskedQuestion: z.boolean().optional(),

  /** Whether the agent's last turn made code changes (optional) */
  lastTurnAgentMadeCodeChanges: z.boolean().optional(),

  /** Human-readable rationale for expected outcome */
  rationale: z.string().optional(),

  /** Additional metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /** Skip this test case */
  skip: z.boolean().optional().default(false),

  /** Reason for skipping */
  skipReason: z.string().optional(),
});

export type TestCase = z.infer<typeof TestCaseSchema>;

/**
 * Corpus metadata
 */
export const CorpusMetadataSchema = z.object({
  /** Human-readable name */
  name: z.string(),

  /** Semantic version */
  version: z.string(),

  /** Target agent type */
  agent: z.string(),

  /** Description */
  description: z.string().optional(),

  /** Creation date */
  created: z.string().optional(),

  /** Author */
  author: z.string().optional(),
});

export type CorpusMetadata = z.infer<typeof CorpusMetadataSchema>;

/**
 * Corpus configuration
 */
export const CorpusConfigSchema = z.object({
  /** Default model to use for classification */
  defaultModel: z.string().optional().default('haiku'),

  /** Timeout in milliseconds for each classification */
  timeoutMs: z.number().optional().default(5000),

  /** Whether to reuse agent instance across test cases */
  reuseAgent: z.boolean().optional().default(true),
});

export type CorpusConfig = z.infer<typeof CorpusConfigSchema>;

/**
 * A complete corpus file
 */
export const CorpusSchema = z.object({
  metadata: CorpusMetadataSchema,
  config: CorpusConfigSchema.optional(),
  cases: z.array(TestCaseSchema),
});

export type Corpus = z.infer<typeof CorpusSchema>;

/**
 * Actual classification path taken
 */
export type ActualPath =
  | 'embedding'
  | 'embedding_timeout_fallback'
  | 'haiku'
  | 'initial_prompt'
  | 'timeout'
  | 'error';

/**
 * Result of evaluating a single test case
 */
export interface CaseResult {
  /** Test case ID */
  caseId: string;

  /** Original prompt */
  prompt: string;

  /** Previous message if multi-turn */
  previousMessage?: string;

  /** Expected values */
  expected: {
    taskType: TaskType;
    path: ExpectedPath;
    minConfidence: number;
  };

  /** Actual classification results */
  actual: {
    taskType: TaskType;
    confidence: number;
    path: ActualPath;
    similarity?: number;
    hasNegation?: boolean;
    reasoning?: string;
  };

  /** Whether the test case passed (classification correct) */
  passed: boolean;

  /** List of classification failures (task type or confidence) */
  failures: string[];

  /** Path warnings (path mismatch - not counted as failure) */
  pathWarnings: string[];

  /** Classification latency in milliseconds */
  latencyMs: number;

  /** Tags from test case */
  tags: string[];

  /**
   * LR vs nearest-neighbor embedding shadow classifiers (assessment-agent embedding path only).
   */
  classifierComparison?: {
    agree: boolean;
    lr: {
      taskType: TaskType;
      confidence: number;
      requiresHaikuVerification: boolean;
    };
    nn: {
      taskType: TaskType;
      confidence: number;
      requiresHaikuVerification: boolean;
    };
  };
}

/**
 * Classification metrics for a category or overall
 */
export interface ClassificationMetrics {
  /** Total number of cases */
  total: number;

  /** Number of correct classifications */
  correct: number;

  /** Accuracy (correct / total) */
  accuracy: number;

  /** Precision (true positives / predicted positives) */
  precision: number;

  /** Recall (true positives / actual positives) */
  recall: number;

  /** F1 score (harmonic mean of precision and recall) */
  f1: number;
}

/**
 * Confusion matrix for classification results
 */
export interface ConfusionMatrix {
  /** Labels in order */
  labels: TaskType[];

  /** Matrix[actual][predicted] = count */
  matrix: number[][];
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  /** Average latency in ms */
  avg: number;

  /** Median (p50) latency */
  p50: number;

  /** 95th percentile latency */
  p95: number;

  /** Minimum latency */
  min: number;

  /** Maximum latency */
  max: number;
}

/**
 * Aggregated LR vs NN (embedding) shadow metrics for assessment-agent evals.
 */
export interface ClassifierAbSummary {
  casesWithShadow: number;
  agreeCount: number;
  disagreeCount: number;
  agreeRatio: number;
  disagreeRatio: number;
  lrMatchesGoldNnWrongCount: number;
  lrMatchesGoldNnWrongRatio: number;
  nnHaikuLrConfidentSetupCount: number;
  nnHaikuLrConfidentFastPathGoldCount: number;
  nnHaikuLrConfidentFastPathGoldRatio: number;
}

/**
 * Complete evaluation report
 */
export interface EvalReport {
  /** Report metadata */
  metadata: {
    timestamp: string;
    corpusPath: string;
    corpusName: string;
    modelUsed: string;
    duration: number;
  };

  /** Summary statistics */
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    accuracy: number;
    avgLatencyMs: number;
    embeddingPathRatio: number;
    embeddingTimeoutFallbackPathRatio: number;
    haikuPathRatio: number;
    initialPromptPathRatio: number;
    /** Number of cases with path mismatches (not failures) */
    pathMismatches: number;
  };

  /** LR vs NN shadow classifier agreement and gold-label breakdown (assessment-agent only). */
  classifierAb?: ClassifierAbSummary;

  /** Detailed metrics */
  metrics: {
    overall: ClassificationMetrics;
    byTaskType: Record<TaskType, ClassificationMetrics>;
    byTag: Record<string, ClassificationMetrics>;
    byPath: Record<ActualPath, ClassificationMetrics>;
  };

  /** Confusion matrix */
  confusionMatrix: ConfusionMatrix;

  /** Latency statistics */
  latency: LatencyStats;

  /** Individual case results */
  cases: CaseResult[];

  /** Failed cases summary (classification failures only) */
  failures: Array<{
    caseId: string;
    prompt: string;
    expected: TaskType;
    actual: TaskType;
    failures: string[];
  }>;

  /** Path warnings summary (cases where path didn't match expectation) */
  pathWarnings: Array<{
    caseId: string;
    prompt: string;
    expectedPath: ExpectedPath;
    actualPath: ActualPath;
    warning: string;
  }>;
}
