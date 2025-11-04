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

// Utility exports
export * from './utils/env-config.js'
export * from './utils/file-processor.js'
export * from './utils/image-content-builder.js'
export * from './utils/model-pricing.js'
export * from './utils/token-counter.js'
export * from './utils/s2s-auth.js'
export * from './utils/embeddings.js'
export * from './utils/retry-with-backoff.js'

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
  estimateTokens,
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
