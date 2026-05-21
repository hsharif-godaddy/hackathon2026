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

// LLM Response Metadata Capture (shared by WS + SSE)
export { captureResponseMetadata, awaitResponseMetadata } from './response-metadata-capture.js'
export type { ResponseMetadata } from './response-metadata-capture.js'

// SSE Formatting
export { formatSSEEvent, safeFormatSSEEvent } from './sse-format.js'
export type { SSEFormatLogger } from './sse-format.js'
export { createSSEWriter } from './sse-writer.js'
export type { SSEWriter, SSEWriterOptions, SSEEncoding } from './sse-writer.js'

// Event Coalescing (recovery replay)
export { coalesceEvents } from './coalesce-events.js'

// Stream Part Processing
export { StreamPartProcessor } from './stream-part-processor.js'
export type { PartProcessorCallbacks, PartProcessorState, ToolCallRecord } from './stream-part-processor.js'

// Skill output redaction (shared by WS + SSE transports before emitting tool-result)
export { redactSkillOutput } from './redact-skill-output.js'

// Non-idempotent tool detection (for mid-stream budget retry decisions)
export { hasNonIdempotentTools } from './non-idempotent-tools.js'

// Mid-stream budget recovery (shared by WS + SSE transports)
export { withBudgetRecovery, invokeBudgetRecoveryCallback, buildContinuationPrompt, MAX_BUDGET_RETRIES, BudgetRecoveryTimeoutError } from './budget-recovery.js'
export type { BudgetRecoveryCallback, BudgetRecoveryResult, BudgetRecoveryStreamOptions } from './budget-recovery.js'

// OTel trace/span ID capture (for correlating client feedback to Langfuse)
export { getCurrentTraceIds } from './otel-trace-ids.js'
export type { TraceIds } from './otel-trace-ids.js'

// Signals + OTEL trace context for chat transports (WS handshake, SSE request)
export { buildChatSignalsTraceContext } from './chat-signals-trace-context.js'
export type {
  ChatSignalsTraceLogPrefix,
  ChatSignalsTraceLogger,
  JwtAgentContextSubset,
} from './chat-signals-trace-context.js'

// LLM provider inference for OTEL invocation spans
export { inferProviderFromModelName } from './infer-llm-provider.js'
export type { ChatLlmProvider } from './infer-llm-provider.js'

// Turn-level error classification (shared by WS catch block + SSE outer catch).
export { analyzeStreamError, isNetworkError } from './analyze-stream-error.js'
export type { AnalyzedStreamError } from './analyze-stream-error.js'
export { classifyTurnError } from './classify-turn-error.js'
export type { ClassifiedTurnError, TurnErrorType } from './classify-turn-error.js'

// Turn-level observability primitives (invocation span + error emission).
export { formatAgentId, emitTurnError, createAgentInvocation } from './agent-invocation.js'
export type {
  EmitTurnErrorOptions,
  TurnErrorLogger,
  AgentInvocationHandle,
  AgentInvocationOptions,
  InvocationEndSuccess,
  InvocationUsage,
  AgentForInvocation,
} from './agent-invocation.js'

// Agent Execution Loop
export { executeAgentLoop, AgentNotFoundError, MAX_HANDOFFS } from './agent-execution-loop.js'
export type { AgentExecutionLoopCallbacks, AgentExecutionLoopResult, AgentExecutionTermination, LoopObservabilityOptions } from './agent-execution-loop.js'

// Client Action Registry
export { ClientActionRegistry } from './client-action-registry.js'
export type { ClientActionHandler, ClientActionRequest, ClientActionResult } from './client-action-registry.js'

// Post-stream validator orchestration (shared WS + SSE)
export { runPostStreamValidation, turnEndedWithStopAfterTool } from './post-stream-validation-runner.js'
export type {
  ValidationStatus,
  ValidationMessageEventData,
  PostStreamValidatorInput,
  PostStreamValidatorResult,
  PostStreamValidatorFn,
  PostStreamValidationLogger,
  RunPostStreamValidationParams,
  RunPostStreamValidationResult,
} from './post-stream-validation-runner.js'

// Recovery Plan (shared WS + SSE replay decision)
export { computeRecoveryPlan } from './recovery-plan.js'
export type { RecoveryPlan, RecoveryPlanInput } from './recovery-plan.js'

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
