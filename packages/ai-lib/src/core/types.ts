import type { LanguageModel, Tool } from 'ai'
import type { z } from 'zod'
import type { MessageBuilder } from './message-builder.js'

/**
 * Global configuration for the agent factory
 */
export interface GlobalAgentConfig {
  /** Default provider to use when not specified */
  defaultProvider?: 'openai' | 'anthropic' | 'bedrock' | 'custom'
  /** Default model to use when not specified */
  defaultModel?: string | LanguageModel
  /** Global tools available to all agents */
  globalTools?: Tool[]
  /** Global provider options */
  providerOptions?: Record<string, any>
  /** Global temperature setting */
  defaultTemperature?: number
  /** Global max tokens setting */
  defaultMaxTokens?: number
}

/**
 * Configuration for a single agent
 */
export interface AgentConfig {
  /** Human-readable name of the agent */
  name: string
  /** System prompt for the agent (used with default message builder) */
  systemPrompt?: string
  /** Message builder for constructing messages */
  messageBuilder?: MessageBuilder
  /** Model to use (can be string ID or LanguageModel instance) */
  model?: string | LanguageModel
  /** Tools available to this agent */
  tools?: Tool[] | Record<string, Tool>
  /** Temperature for generation (0-2) */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Enable agentic loop control */
  enableLoopControl?: boolean
  /** Provider-specific options */
  providerOptions?: {
    anthropic?: {
      cacheControl?: { type: 'ephemeral' }
    }
    openai?: {
      parallel_tool_calls?: boolean
    }
    [key: string]: any
  }
}

/**
 * Runtime context passed to agents during execution
 */
export interface AgentContext {
  /** Conversation history messages */
  messages?: Array<{
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
    input: any
    result?: any
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
    input?: any
    result?: any
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
  execute: (input: any, context?: AgentContext) => Promise<any>
  /** Provider-specific options */
  providerOptions?: Record<string, any> | undefined
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  /** Tool name */
  toolName: string
  /** Tool input */
  input: any
  /** Tool output */
  output: any
  /** Execution time in milliseconds */
  executionTime?: number
  /** Whether execution was successful */
  success: boolean
  /** Error message if execution failed */
  error?: string
}

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
  providerOptions?: Record<string, any>
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
  structuredData?: any
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
