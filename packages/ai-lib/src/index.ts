// Core exports
export * from './core/types.js'
export * from './core/agent-factory.js'
export { runWithModelOverride, getActiveModelOverride } from './core/model-override-context.js'
export type {
  ContextPipeline,
  TransformContextInput,
  TransformContextOutput,
  ConvertToLlmInput,
  PipelineContextMessage,
  PipelineExecutionContext,
  CachePointMetadata,
} from './core/context-pipeline.js'
export {
  defaultConvertToLlm,
  createDefaultPipeline,
  normalizeContextMessages,
  normalizeConversationMessages,
  applyPromptCaching,
  buildUserMessage,
} from './core/context-normalization.js'

// Provider exports
export * from './providers/unified-provider.js'

// Tool exports
export * from './tools/index.js'

// Prompt building exports
export * from './prompt/prompt-builder.js'

// Utility exports
export * from './utils/file-processor.js'
export * from './utils/image-content-builder.js'
export {
  generateImageWithModel,
  type GeminiImageGenerationOptions,
  type GeminiImageGenerationResult
} from './utils/image-generation.js'
export * from './utils/model-pricing.js'
export * from './utils/token-counter.js'
export * from './utils/s2s-auth.js'
export * from './utils/embeddings.js'
export * from './utils/tool-llm-helper.js'
export * from './utils/prompt-caching.js'
export { supportsEffort, normalizeModelName } from './utils/model-normalization.js'

// Convenience re-exports
export {
  AgentFactory,
  AgentWrapper,
  createAgentFactory,
  defaultAgentFactory
} from './core/agent-factory.js'
export {
  SimpleMessageBuilder,
  CachingMessageBuilder,
  ConversationMessageBuilder,
  createSimpleMessageBuilder,
  createCachingMessageBuilder,
  createConversationMessageBuilder
} from './core/message-builder.js'
export { getModel, getAvailableModels, isModelSupported, getFullModelName, validateModelEnvironment, getModelInfo, getEmbeddingModel, createOpenAIClient } from './providers/unified-provider.js'
export {
  countTokens,
  countTotalTokens,
  countConversationTokens,
  isTokenCountingSupported,
  getModelProvider,
  type TokenCountResult,
  type ModelProvider,
  type SupportedModel
} from './utils/token-counter.js'
export {
  createPromptBuilder,
  PromptBuilder,
  pb,
  when,
  conditions,
  type PromptContext,
  type ConditionFunction,
  type DynamicTextFunction,
  type DynamicListFunction
} from './prompt/prompt-builder.js'
export {
  createInMemoryHandoffStateManager
} from './tools/handoff-state-manager.js'
export type {
  InMemoryHandoffStateManager,
  InMemoryHandoffStateManagerConfig
} from './tools/handoff-state-manager.js'
