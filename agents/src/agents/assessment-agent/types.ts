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
  Timeout = 'timeout',
  Error = 'error',
  BelowThreshold = 'below_threshold',
  Disabled = 'disabled',
  EmptyPrompt = 'empty_prompt',
}

export const AssessmentResultSchema = z.object({
  taskType: z.nativeEnum(AssessmentTaskType),
  confidence: z.number().min(0).max(100),
  detectedKeywords: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})

export type AssessmentResult = z.infer<typeof AssessmentResultSchema>

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
}

export interface AssessmentOutcome {
  result: AssessmentResult | null
  completedInTime: boolean
  durationMs: number
  overrideApplied: boolean
  appliedBudget?: string
  reason: AssessmentReason
}

export interface CostPrediction {
  estimatedTokens: number
  estimatedToolCalls: number
  estimatedCost: number
  confidence: number
}
