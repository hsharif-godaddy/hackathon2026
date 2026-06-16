/**
 * Shared types for AgentFactory / AgentWrapper.
 *
 * Extracted verbatim from agent-factory.ts to keep that file focused on the
 * factory/wrapper logic. agent-factory.ts re-exports the public ones, so this
 * split is invisible to importers.
 */

import type { ModelMessage } from 'ai'
import type { AgentContext, ProcessedFile } from './types.js'
import type { PipelineContextMessage } from './context-pipeline.js'

/**
 * Extended stream result type for tool validation errors
 * Allows marking mock streams with validation error flags
 */
export interface StreamResultWithValidation {
  textStream: AsyncIterable<string>
  baseStream?: unknown

  response?: PromiseLike<{ id: string; timestamp: Date; modelId: string; headers?: Record<string, string>; body?: any }>
  getFinalResult: () => Promise<any>
  isToolValidationError?: boolean
  validationErrorMessage?: string
}

/**
 * Tool execution hook function types
 */
export type BeforeToolExecutionHook = (toolName: string, args: unknown, context?: AgentContext) => Promise<unknown> | unknown
export type AfterToolExecutionHook = (toolName: string, args: unknown, result: unknown, toolCallError: unknown, context?: AgentContext) => Promise<unknown> | unknown

/**
 * Agent handoff configuration
 */
export interface AgentHandoffConfig {
  /** Name/identifier of the target agent */
  agentName: string
  /** Description of when this handoff should be used */
  description?: string
  /** Whether to include conversation context in handoff */
  includeContext?: boolean
}

/**
 * Handoff execution context
 */
export interface HandoffContext {
  /** Task description for the target agent */
  task: string
  /** Additional context data */
  context?: Record<string, unknown> | undefined
  /** Parameters to pass to the target agent */
  parameters?: Record<string, unknown> | undefined
  /** Metadata about the handoff */
  metadata?: {
    sourceAgent: string
    timestamp: string
    reason?: string | undefined
  } | undefined
}

/**
 * Handoff execution result
 */
export interface HandoffResult {
  /** Whether the handoff was successful */
  success: boolean
  /** Result from the target agent */
  result?: unknown
  /** Error message if handoff failed */
  error?: string
  /** Handoff execution details */
  handoffDetails: {
    sourceAgent: string
    targetAgent: string
    timestamp: string
    context: HandoffContext
  }
}

/**
 * Handoff history entry
 */
export interface HandoffHistoryEntry {
  /** Unique identifier for this handoff */
  id: string
  /** Source agent name */
  sourceAgent: string
  /** Target agent name */
  targetAgent: string
  /** Timestamp of handoff */
  timestamp: string
  /** Task description */
  task: string
  /** Handoff context */
  context: HandoffContext
  /** Result of the handoff */
  result?: HandoffResult
  /** Status of the handoff */
  status: 'pending' | 'completed' | 'failed'
}

/**
 * Call options type for ToolLoopAgent
 * Empty object for now - can be extended for dynamic model selection
 */
export type AgentCallOptions = {
  executionContext?: Record<string, unknown> | undefined
  contextMessages?: PipelineContextMessage[]
  conversationMessages?: ModelMessage[]
  files?: ProcessedFile[]
  basePrompt?: string
}

/**
 * Cache point metadata structure (stored format)
 */
export interface CachePointMetadata {
  type: 'ephemeral'
}

/**
 * Provider-specific options with proper type structure
 */
export interface ProviderOptions {
  anthropic?: {
    cacheControl?: { type: string }

    [key: string]: any
  }

  [key: string]: any
}

/**
 * Message with cache point metadata (stored format from conversation history)
 * Using type alias instead of interface extends to support union types
 *
 * @internal - For future type safety improvements
 */
export type MessageWithCachePoint = ModelMessage & {
  cachePoint?: CachePointMetadata
  providerOptions?: ProviderOptions
}

export interface ResolvedTurnState {
  system?: string
  activeTools?: string[]
}
