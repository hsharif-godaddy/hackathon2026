import type { LanguageModel, Tool, ModelMessage } from 'ai'
import type { z } from 'zod'
import type { RetryOptions } from '@airo/ai-common'
import type { ContextPipeline, PipelineContextMessage } from './context-pipeline.js'

// Re-export AI SDK types for convenience
export type { ModelMessage, LanguageModel, Tool } from 'ai'

/**
 * Agents collection returned from AgentFactory.defineAgents()
 *
 * This is the standard interface for accessing agents in a type-safe way.
 */
export interface AgentsCollection {
  /** Get an agent by ID */
  get: (id: string) => any // AgentWrapper, but avoiding circular dependency
  /** Check if an agent exists */
  has: (id: string) => boolean
  /** List all agent IDs */
  list: () => (string | number)[]
  /** Get agent configuration without creating instance */
  getConfig: (id: string) => AgentConfig
  /** Additional properties from defineAgents return type */
  [key: string]: any
}

/**
 * Skill tool provider interface for skill lifecycle management
 *
 * Skills are pre-registered at startup. The provider supplies all skill tools
 * which are merged with agent tools. activeTools filtering controls visibility.
 * Skills are deactivated after INACTIVITY_THRESHOLD_STEPS of not being used.
 */
export interface SkillToolProvider {
  /** Get all pre-registered skill tools (called once during factory setup) */
  getAllTools: () => Record<string, Tool>

  /** Get all pre-registered skill tool names (for filtering in prepareStep) */
  getSkillToolNames: () => string[]

  /** Get prefixed tool names for all active skills in a conversation */
  getActiveToolNames: (conversationId: string) => string[]

  /** Update skill usage when its tool is called */
  updateSkillUsage: (conversationId: string, skillName: string, stepNumber: number) => void

  /** Cleanup inactive skills based on step threshold */
  cleanupInactiveSkills: (conversationId: string, currentStep: number) => string[]
}

/**
 * Global configuration for the agent factory
 */
export interface GlobalAgentConfig {
  /** Default provider to use when not specified */
  defaultProvider?: 'openai' | 'anthropic' | 'custom'
  /** Default model to use when not specified */
  defaultModel?: string | LanguageModel
  /** Global tools available to all agents */
  globalTools?: Tool[]
  /** Global provider options */
  providerOptions?: Record<string, unknown>
  /** Global temperature setting */
  defaultTemperature?: number
  /** Global max tokens setting */
  defaultMaxTokens?: number
  /** Dynamic skill tool provider for runtime tool injection */
  skillToolProvider?: SkillToolProvider
}

/**
 * Per-turn context passed to AgentConfig resolvers (system, activeTools).
 * Inputs are deterministic so Anthropic-side prompt cache hits when the same
 * context shows up again. Add fields when a new dimension truly changes the
 * resolver output — not as a free-form bag.
 */
export interface ResolverContext {
  /** Resolved profile name for this turn, when one was selected. */
  readonly profileName?: string
  /** BCP-47 market/locale carried on the request, when set. */
  readonly market?: string
}

/**
 * Configuration for a single agent (modern AgentFactory)
 */
export interface AgentConfig {
  /** Agent identifier (keyword) - typically set by defineAgents */
  id?: string
  /** Human-readable name of the agent */
  name: string
  /**
   * System prompt for the agent. Either a static string or a per-turn resolver.
   * When a resolver is supplied, it runs once per turn (in prepareCall) and the
   * result is applied via the AI SDK's prepareStep `system` override. Resolver
   * output should be deterministic for a given ResolverContext so prompt
   * caching keeps hitting.
   */
  system?: string | ((ctx: ResolverContext) => string | Promise<string>)
  /** Model to use (must be LanguageModel instance) */
  model: LanguageModel
  /** Original model name used for token cost calculations */
  modelName?: string
  /**
   * Tools available to this agent. The map should be the union of every tool
   * the agent might use across configurations; per-turn visibility is controlled
   * via `activeTools`. The LLM only sees tools listed in the resolved activeTools
   * set, so union'd tools that aren't currently active can never be called.
   */
  tools?: Record<string, unknown>
  /**
   * Per-turn filter over tools. When provided, only tools whose name is in the
   * resolved set are exposed to the LLM for this turn. Use this to express
   * profile- or request-driven tool gating without rebuilding the agent.
   */
  activeTools?: string[] | ((ctx: ResolverContext) => string[] | Promise<string[]>)
  /** Temperature for generation (0-1) */
  temperature?: number
  /** Maximum tokens to generate */
  maxOutputTokens?: number
  /** Stop conditions for agentic loops */
  stopWhen?: Array<(result: unknown) => boolean>
  /** Maximum steps for agentic reasoning */
  maxSteps?: number
  /**
   * Stop after specific tool calls. This list is fixed at construction time —
   * the AI SDK's prepareStep cannot override stop conditions per turn. To
   * support profile- or request-driven gating, union all possibly-stopping
   * tool names here: a stop condition only fires when the tool actually
   * executes, and tools not in the resolved `activeTools` set can never
   * execute, so unused entries are inert.
   */
  stopAfterTools?: string[]
  /** Explicit provider-specific options. These are passed through as provided; model defaults are set on model definitions. */
  providerOptions?: Record<string, unknown>
  /** Hook called before each tool execution */
  beforeToolExecution?: (toolName: string, args: unknown, context?: AgentContext) => Promise<unknown> | unknown
  /** Hook called after each tool execution */
  afterToolExecution?: (toolName: string, args: unknown, result: unknown, toolCallError: unknown, context?: AgentContext) => Promise<unknown> | unknown
  /** Available handoff targets for this agent */
  handoffs?: Array<{
    agentName: string
    description?: string
    includeContext?: boolean
  }>
  /**
   * Override default retry options for LLM API calls.
   * Uses retryWithBackoff with exponential backoff + jitter.
   * Default: 5 attempts, 1s base delay, 2x factor, 16s max delay.
   */
  retryConfig?: RetryOptions
  /** Timeout configuration for LLM calls (passed to AI SDK) */
  timeout?: {
    /** Total timeout for entire agent run in ms */
    totalMs?: number
    /** Timeout per individual LLM step in ms */
    stepMs?: number
    /** Timeout between stream chunks in ms (streaming only) — detects stalled streams */
    chunkMs?: number
  }
  /** Structured logger for telemetry, step tracking, and cache management */
  logger: {
    info: (event: string, data: unknown) => void
    warn: (event: string, data: unknown) => void
    error: (event: string, data: unknown) => void
  }
  /** Agent-specific metadata for custom configuration */
  metadata?: Record<string, unknown>
  /** Enable automatic prompt caching for this agent */
  enablePromptCaching?: boolean | {
    /** Cache system prompts (default: true) */
    cacheSystemPrompts?: boolean
    /** Maximum cache breakpoints to use (Anthropic limit: 4, default: 2) */
    maxBreakpoints?: number
  }
  /** Context pipeline for message transformation (two-stage: transformContext → convertToLlm). When omitted, a default pipeline using defaultConvertToLlm is used. */
  contextPipeline?: ContextPipeline

  /** Called before the first LLM step to inject skill context messages.
   *  On success (non-empty return), the result is cached and the callback is not called again for that conversationId.
   *  On failure (empty return or throw), retries up to 3 times across subsequent turns, then gives up. */
  onSkillsLoad?: (conversationId: string) => Promise<PipelineContextMessage[]>

}

/**
 * Runtime context passed to agents during execution
 */
export interface AgentContext {
  /** Conversation history messages in AI SDK v6 ModelMessage format */
  messages?: ModelMessage[]
  /** Initial context messages to include before conversation history */
  initialContextMessages?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
  }>
  /** Unique session/thread identifier */
  sessionId?: string
  /** User identifier */
  userId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Request timestamp */
  timestamp?: Date
  /** Files to include in the request (for vision/document analysis) */
  files?: ProcessedFile[]
}

/**
 * Caching metrics from provider responses
 */
export interface CachingMetrics {
  /** Tokens served from cache */
  cachedInputTokens?: number
  /** Tokens written to cache */
  cacheWriteInputTokens?: number
  /** Cache hit rate (0-1) */
  cacheHitRate?: number
  /** Whether caching was enabled for this request */
  cachingEnabled?: boolean
}

/**
 * Result from agent generation
 */
export interface AgentResult {
  /** Generated content */
  content: string
  /** Tool calls made during generation */
  toolCalls?: Array<{
    id: string
    name: string
  input: unknown
  result?: unknown
  }>
  /** Token usage information */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    /** Tokens served from cache (when caching is enabled) */
    cachedInputTokens?: number
  } | undefined
  /** Finish reason */
  finishReason?: string
  /** Caching performance metrics */
  caching?: CachingMetrics
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined
}

/**
 * Options for agentic loop execution
 */
export interface AgenticLoopOptions {
  /** Maximum number of steps to execute */
  maxSteps?: number
  /** Callback called after each step */
  onStep?: (step: AgentStep) => void | Promise<void>
  /** Custom stop condition */
  stopCondition?: (result: AgentResult) => boolean
  /** Additional context for the loop */
  context?: AgentContext
}

/**
 * Information about a single step in an agentic loop
 */
export interface AgentStep {
  /** Step number (1-indexed) */
  stepNumber: number
  /** Input to this step */
  input: string
  /** Result from this step */
  result: AgentResult
  /** Whether this is the final step */
  isFinal: boolean
}

/**
 * Custom data parts for streaming
 */
export interface DefaultDataParts {
  'agent-status': {
    status: 'thinking' | 'executing' | 'complete' | 'error'
    message?: string
  }
  'tool-execution': {
    toolName: string
    status: 'started' | 'completed' | 'failed'
  input?: unknown
  result?: unknown
    error?: string
  }
  'progress': {
    step: number
    total: number
    description?: string
  }
}

/**
 * Tool definition interface
 */
export interface ToolDefinition {
  /** Tool name */
  name: string
  /** Tool description */
  description: string
  /** Input schema using Zod */
  inputSchema: z.ZodSchema
  /** Tool execution function */
  execute: (input: unknown, context?: AgentContext) => Promise<unknown>
  /** Provider-specific options */
  providerOptions?: Record<string, unknown> | undefined
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  /** Tool name */
  toolName: string
  /** Tool input */
  input: unknown
  /** Tool output */
  output: unknown
  /** Execution time in milliseconds */
  executionTime?: number
  /** Whether execution was successful */
  success: boolean
  /** Error message if execution failed */
  error?: string
}

// (Removed granular retry callback event types in favor of unified logger interface)

/**
 * Image generation options
 */
export interface ImageGenerationOptions {
  /** Text prompt describing the image to generate */
  prompt: string
  /** Number of images to generate (default: 1) */
  n?: number
  /** Image size specification */
  size?: string
  /** Aspect ratio for the image */
  aspectRatio?: string
  /** Seed for reproducible generation */
  seed?: number
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>
  /** Maximum number of retries */
  maxRetries?: number
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
}

/**
 * Generated image result
 */
export interface ImageResult {
  /** Generated image URL or base64 data */
  url?: string
  /** Base64 encoded image data */
  base64?: string
  /** Image metadata */
  metadata?: {
    size?: string
    aspectRatio?: string
    seed?: number
    revisedPrompt?: string
  }
}

/**
 * Image generation result
 */
export interface ImageGenerationResult {
  /** Generated images */
  images: ImageResult[]
  /** Token usage for the generation */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  } | undefined
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined
}

/**
 * Embedding generation options
 */
export interface EmbeddingOptions {
  /** Embedding model to use */
  model?: string
  /** Number of dimensions for the embedding */
  dimensions?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Single embedding result
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[]
  /** Number of dimensions */
  dimensions: number
}

/**
 * Embeddings generation result
 */
export interface EmbeddingsResult {
  /** Generated embeddings */
  embeddings: EmbeddingResult[]
  /** Token usage for the generation */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  } | undefined
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined
}

/**
 * Supported file types for input
 */
export type SupportedFileType =
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv'
  | 'application/json'
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation' // .pptx

/**
 * File input configuration
 */
export interface FileInput {
  /** Path to the file or file buffer */
  source: string | Buffer | Uint8Array
  /** MIME type of the file */
  mimeType: SupportedFileType
  /** Optional filename for context */
  filename?: string
  /** Optional description of the file's purpose */
  description?: string
  /** Processing options */
  options?: FileProcessingOptions
}

/**
 * File processing options
 */
export interface FileProcessingOptions {
  /** Maximum file size in bytes (default: 10MB) */
  maxSize?: number
  /** Text extraction options for documents */
  textExtraction?: {
    /** Include formatting information */
    includeFormatting?: boolean
    /** Extract tables as structured data */
    extractTables?: boolean
    /** Extract metadata from document */
    extractMetadata?: boolean
  }
  /** Image processing options */
  imageProcessing?: {
    /** Resize image to max dimensions */
    maxDimensions?: { width: number; height: number }
    /** Image quality (0-100) */
    quality?: number
    /** Convert to specific format */
    convertTo?: 'jpeg' | 'png' | 'webp'
  }
}

/**
 * Processed file result
 */
export interface ProcessedFile {
  /** Original file input */
  input: FileInput
  /** Extracted text content (if applicable) */
  textContent?: string
  /** Base64 encoded content for images */
  base64Content?: string
  /** Structured data (for CSV, JSON, etc.) */
  structuredData?: unknown
  /** File metadata */
  metadata: {
    size: number
    mimeType: string
    filename?: string
    extractedAt: Date
    processingTime: number
  }
  /** Any processing errors or warnings */
  warnings?: string[]
}

/**
 * File input context for agent processing
 */
export interface FileInputContext {
  /** Processed files */
  files: ProcessedFile[]
  /** Summary of all file contents */
  summary?: string
  /** Combined text content from all files */
  combinedText?: string
}
