// Modern WebSocket Server
export {
  WebSocketServer,
  createWebSocketServer,
  createSingleAgentFactory,
  createSingleAgentWebSocketServer
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
export {
  WebSocketSubscriber
} from './subscribers/websocket-subscriber.js'
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

// Event Coalescing (recovery replay)
export { coalesceEvents } from './coalesce-events.js'

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
