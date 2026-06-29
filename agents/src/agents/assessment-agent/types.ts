import { z } from 'zod'

export enum AssessmentTaskType {
  Publish = 'publish',
  Domain = 'domain',
  Fix = 'fix',
  General = 'general',
}

export enum AssessmentReason {
  LlmCompleted = 'llm_completed',
  EmbeddingCompleted = 'embedding_completed',
  /** Haiku was needed (low confidence / negation) but skipped because <500ms remained in the budget */
  EmbeddingTimeoutFallback = 'embedding_timeout_fallback',
  InitialPrompt = 'initial_prompt',
  Timeout = 'timeout',
  Error = 'error',
  BelowThreshold = 'below_threshold',
  Disabled = 'disabled',
  EmptyPrompt = 'empty_prompt',
  FixIntentBypass = 'fix_intent_bypass',
}

export const AssessmentResultSchema = z.object({
  taskType: z.nativeEnum(AssessmentTaskType),
  confidence: z.number().min(0).max(100),
  detectedKeywords: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})

export type AssessmentResult = z.infer<typeof AssessmentResultSchema>

/** For CosineSimilarity mode: Haiku prompt covers all four task types. */
export const HaikuAssessmentResultSchema = z.object({
  taskType: z.enum([AssessmentTaskType.Fix, AssessmentTaskType.General, AssessmentTaskType.Domain, AssessmentTaskType.Publish]),
  confidence: z.number().min(0).max(100),
  detectedKeywords: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})

/** For LogisticRegression mode: Haiku prompt is binary (fix|general); reject publish/domain at parse time. */
export const HaikuBinaryAssessmentResultSchema = z.object({
  taskType: z.enum([AssessmentTaskType.Fix, AssessmentTaskType.General]),
  confidence: z.number().min(0).max(100),
  detectedKeywords: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})

export enum ClassifierMode {
  LogisticRegression = 'logistic-regression',
  CosineSimilarity = 'cosine-similarity',
}

export interface IClassifier {
  initialize(): Promise<void>
  classify(prompt: string): Promise<ClassificationResult>
  isReady(): boolean
}

export interface ClassificationResult {
  taskType: AssessmentTaskType
  confidence: number
  similarity: number
  matchedExample: string
  margin: number
  method: 'embedding-nn' | 'embedding-lr'
  hasNegation: boolean
  /** True if the classifier is not confident enough to skip Haiku verification */
  requiresHaikuVerification: boolean
}

export enum ConversationRole {
  user = 'user',
  agent = 'agent',
}

export interface ConversationTurn {
  role: ConversationRole
  content: string
}

export interface AssessmentConfig {
  timeoutMs: number
  confidenceThreshold: number
  enabled: boolean
}

export interface AssessmentContext {
  appId?: string
  customerId?: string
  socketId?: string
  enabledOverride?: boolean
  /** Previous user message for multi-turn context (e.g., "fix my button" before "it doesn't work") */
  previousUserMessage?: string
  /** Previous assessment's task type for session context gating (enables Haiku for below-threshold follow-ups in active fix/publish/domain sequences) */
  previousAssessmentTaskType?: AssessmentTaskType
  /**
   * True if this is the first message for a new app.
   * Initial prompts are always creation intent - you can't publish/fix/domain an app that doesn't exist.
   * When true, classification returns 'general' immediately (no budget override).
   */
  isInitialPrompt?: boolean
  /** Which classifier implementation to use for this request (derived from switchboard via JWT). */
  classifierMode?: ClassifierMode
  /** True when a fix session is active for this session (gathering or attempted). */
  fixSessionActive?: boolean
  /** Recent conversation turns (user + agent, last 3, oldest-first) for expanded Haiku context. */
  recentTurns?: ConversationTurn[]
  /** The current fix session phase: gathering info vs fix attempted. */
  fixSessionPhase?: FixSessionPhase
  /** True when the agent's last turn used a question tool (askQuestion/suggestedResponse). */
  lastTurnAgentAskedQuestion?: boolean
  /** True when the agent's last turn made code changes (str_replace_based_edit_tool, write_to_file). */
  lastTurnAgentMadeCodeChanges?: boolean
  /** Callback invoked with the intermediate LR/embedding result before Haiku tiebreaker runs. */
  onClassifierResult?: (result: ClassificationResult) => void
}

export interface AssessmentOutcome {
  result: AssessmentResult | null
  completedInTime: boolean
  durationMs: number
  overrideApplied: boolean
  appliedBudget?: string
  reason: AssessmentReason
}

export interface ABComparisonResult {
  modelA: ClassifierMode
  modelB: ClassifierMode
  outcomeA: AssessmentOutcome
  outcomeB: AssessmentOutcome
  taskTypeAgree: boolean
  overrideAgree: boolean
  haikuEscalationAgree: boolean
  confidenceDelta: number
  latencyDeltaMs: number
}

export enum FixSessionPhase {
  Gathering = 'gathering',
  Attempted = 'attempted',
}

export interface CostPrediction {
  estimatedTokens: number
  estimatedToolCalls: number
  estimatedCost: number
  confidence: number
}
