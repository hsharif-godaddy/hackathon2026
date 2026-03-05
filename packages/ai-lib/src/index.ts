// Core exports
export * from './core/types.js'
export * from './core/agent-factory.js'

// Provider exports
export * from './providers/unified-provider.js'

// Tool exports
export * from './tools/index.js'

// Prompt building exports
export * from './prompt/prompt-builder.js'

// WebSocket exports
export * from './websocket/index.js'

// Skills exports
export * from './skills/index.js'

// Utility exports
export * from './utils/env-config.js'
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
export * from './utils/errors.js'
export * from './utils/retry-with-backoff.js'
export * from './utils/logger.js'
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
  WebSocketServer,
  createWebSocketServer,
  createSingleAgentFactory,
  createSingleAgentWebSocketServer,
  type MessageProvider,
  type ContextProvider,
  type ConversationPersistence,
  type WebSocketConfig,
  type ChatMessage
} from './websocket/index.js'
export { EnvConfig } from './utils/env-config.js'
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

// Grants exports (for agents/server-side)
export {
  buildLitellmMetadataFromContext,
  isGrantsExhausted,
  setAPM,
  LlmCallSource,
  GrantErrorCode,
  SpecialSubscriptionId,
} from './grants/build-metadata.js'
export type { ExecutionContext, ExecutionContextMetadata } from './grants/build-metadata.js'
export { GrantManager, GrantUnusableReason } from './grants/index.js'
export { GrantSessionManager, grantSessionManager } from './grants/index.js'
export type { CreditGrant, GrantContextPayload } from './grants/index.js'
export { GrantType, GrantFinalState } from './grants/index.js'
