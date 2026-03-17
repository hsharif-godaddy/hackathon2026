import type { ModelMessage, UserModelMessage, LanguageModel } from 'ai'
import type { ProcessedFile } from './types.js'

/**
 * Cache point metadata for prompt caching (Anthropic/Bedrock).
 */
export interface CachePointMetadata {
  type: 'ephemeral'
}

/**
 * A context message with metadata for ordering and caching.
 * Produced by the application layer, consumed by convertToLlm.
 */
export interface PipelineContextMessage {
  role: 'system' | 'user'
  content: string
  insertionOrder?: 'before_history' | 'after_history'
  cachePoint?: CachePointMetadata
  /** Provider-specific options (e.g., Anthropic cacheControl, Bedrock cachePoint). Preserved through normalization. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerOptions?: Record<string, Record<string, any>>
}

/**
 * Execution context metadata passed through the pipeline.
 */
export interface PipelineExecutionContext {
  appId?: string
  userId?: string
  customerId?: string
  conversationId?: string
  sessionId?: string
  agentId?: string
  [key: string]: unknown
}

/**
 * Input to the transformContext stage.
 */
export interface TransformContextInput {
  /** The current user message text */
  userMessage: string
  /** Files attached to the user message (for vision) */
  files?: ProcessedFile[]
  /** Injected context: visual, file, skill, template context */
  contextMessages: PipelineContextMessage[]
  /** Conversation history from database */
  conversationMessages: ModelMessage[]
  /** Metadata about the current execution */
  executionContext: PipelineExecutionContext
  /** Which turn in the agentic loop (0-indexed) */
  turnIndex: number
}

/**
 * Output from transformContext, input to convertToLlm.
 */
export interface TransformContextOutput {
  /** Transformed context messages */
  contextMessages: PipelineContextMessage[]
  /** Transformed conversation history */
  conversationMessages: ModelMessage[]
  /** The current user message (may include file content). Undefined when prompt is empty. */
  userMessage?: UserModelMessage | undefined
}

/**
 * Additional input for the convertToLlm stage.
 */
export interface ConvertToLlmInput extends TransformContextOutput {
  /** The model being used (for provider-specific caching) */
  model: LanguageModel
  /** Whether to apply prompt caching (boolean or strategy object) */
  enablePromptCaching: boolean | { cacheSystemPrompts?: boolean; maxBreakpoints?: number }
  /** Whether the agent has a system prompt set (affects breakpoint slot reservation) */
  hasSystemPrompt?: boolean
}

/**
 * Two-stage pipeline for assembling LLM context.
 *
 * Stage 1 (transformContext): Application-level transformation.
 *   Load history, inject context, apply compression, manage token budget.
 *
 * Stage 2 (convertToLlm): LLM-level formatting.
 *   Normalize message types, apply prompt caching, strip non-LLM content.
 */
export interface ContextPipeline {
  transformContext(input: TransformContextInput): Promise<TransformContextOutput>
  convertToLlm(input: ConvertToLlmInput): ModelMessage[]
}
