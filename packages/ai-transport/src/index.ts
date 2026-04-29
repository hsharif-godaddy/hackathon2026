// Modern WebSocket Server
export {
  WebSocketServer,
  createWebSocketServer,
  createSingleAgentFactory,
  createSingleAgentWebSocketServer,
  restoreBudgetMetadata
} from './experimental-websocket-server.js'
export type {
  WebSocketConfig,
  ChatMessage,
  MessageProvider,
  ContextProvider,
  ConversationPersistence,
  ConversationPersistenceWithCleanup,
  ConversationMessage,
  PersistenceStreamingEvent,
  ConversationContext
} from './experimental-websocket-server.js'

// Event Channel Infrastructure
export {
  ConversationEventChannel,
  CircularBuffer
} from './conversation-event-channel.js'
export type {
  EventChannelLogger
} from './conversation-event-channel.js'
export type {
  StreamingEvent,
  StreamingEventType,
  EventSubscriber,
  EventMetadata,
  CircularBufferConfig,
  HistoryProvider,
  PersistedMessage,
  RecoveryStatusData
} from './interfaces.js'

// No-op Persistence for Tests/Examples
export {
  NoOpPersistence,
  createNoOpPersistence
} from './noop-persistence.js'

// Event Subscribers
export { BaseEventSubscriber } from './subscribers/base-subscriber.js'
export {
  WebSocketSubscriber
} from './subscribers/websocket-subscriber.js'
export {
  SSESubscriber
} from './subscribers/sse-subscriber.js'
export {
  PersistenceSubscriber
} from './subscribers/persistence-subscriber.js'
export type {
  PersistenceLogger
} from './subscribers/persistence-subscriber.js'
export {
  APMSubscriber
} from './subscribers/apm-subscriber.js'
export type {
  WebSocketMessage,
  IsDisconnectedFn
} from './subscribers/websocket-subscriber.js'
export type { CoalescerConfig, CoalescedMessage } from './subscribers/event-coalescer.js'
export { EventCoalescer } from './subscribers/event-coalescer.js'
export type {
  APMAgent,
  APMSpan,
  APMTransaction
} from './subscribers/apm-subscriber.js'

// Connection State Management
export {
  ConnectionStateManager
} from './connection-state-manager.js'
export type {
  ConnectionState,
  ConnectionStateData,
  CreateConnectionParams,
  TransitionParams,
  ConnectionStateManagerConfig,
  StateManagerLogger
} from './connection-state-manager.js'

// SSE Formatting
export { formatSSEEvent } from './sse-format.js'

// Event Coalescing (recovery replay)
export { coalesceEvents } from './coalesce-events.js'

// Stream Part Processing
export { StreamPartProcessor } from './stream-part-processor.js'
export type { PartProcessorCallbacks, PartProcessorState, ToolCallRecord } from './stream-part-processor.js'

// Skill output redaction (shared by WS + SSE transports before emitting tool-result)
export { redactSkillOutput } from './redact-skill-output.js'

// Agent Execution Loop
export { executeAgentLoop, AgentNotFoundError, MAX_HANDOFFS } from './agent-execution-loop.js'
export type { AgentExecutionLoopCallbacks, AgentExecutionLoopResult, AgentExecutionTermination } from './agent-execution-loop.js'

// Client Action Registry
export { ClientActionRegistry } from './client-action-registry.js'
export type { ClientActionHandler, ClientActionRequest, ClientActionResult } from './client-action-registry.js'

// Connection Recovery Management
export {
  ConnectionRecoveryManager
} from './connection-recovery-manager.js'
export type {
  RecoveryMode,
  RecoveryContext,
  ConnectionRecoveryManagerConfig,
  ConnectionRecoveryManagerDependencies,
  RecoveryManagerLogger
} from './connection-recovery-manager.js'
