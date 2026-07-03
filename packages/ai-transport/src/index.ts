// Shared persistence/context types
export type {
  MessageProvider,
  ContextProvider,
  ConversationPersistence,
  ConversationPersistenceWithCleanup,
  ConversationMessage,
  PersistenceStreamingEvent,
  ConversationContext
} from './interfaces.js'

// Event Channel Infrastructure
export {
  ConversationEventChannel,
  CircularBuffer
} from './conversation-event-channel.js'
export type {
  EventChannelLogger
} from './conversation-event-channel.js'
export {
  STREAMING_EVENT_TYPES,
  TOOL_VALIDATION_ERROR_TYPE,
} from './interfaces.js'
export type {
  StreamingEvent,
  StreamingEventType,
  EventSubscriber,
  EventMetadata,
  CircularBufferConfig,
  HistoryProvider,
  PersistedMessage
} from './interfaces.js'

// No-op Persistence for Tests/Examples
export {
  NoOpPersistence,
  createNoOpPersistence
} from './noop-persistence.js'

// Event Subscribers
export { BaseEventSubscriber } from './subscribers/base-subscriber.js'
export {
  SSESubscriber
} from './subscribers/sse-subscriber.js'
export {
  PersistenceSubscriber
} from './subscribers/persistence-subscriber.js'
export type {
  PersistenceLogger
} from './subscribers/persistence-subscriber.js'
export type { CoalescerConfig, CoalescedMessage } from './subscribers/event-coalescer.js'
export { EventCoalescer } from './subscribers/event-coalescer.js'

// LLM Response Metadata Capture (shared by WS + SSE)
export { captureResponseMetadata, awaitResponseMetadata } from './response-metadata-capture.js'
export type { ResponseMetadata } from './response-metadata-capture.js'

// Message Assembly (shared by WS + SSE)
export { assembleMessages, dropTrailingPrompt } from './assemble-messages.js'
export type { AssembleMessagesInput, AssembleMessagesResult, ContextMessage, HistoryMessage, MessageRole, InsertionOrder } from './assemble-messages.js'
export { stripLeadingOrphanTools } from './strip-orphan-tools.js'
export type { StrippedToolMessage } from './strip-orphan-tools.js'

// Text Stream Fallback (shared by WS + SSE)
export { readTextStreamFallback } from './text-stream-fallback.js'
export type { TextStreamFallbackDeps } from './text-stream-fallback.js'

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

// Stream Timing Tracker (shared WS + SSE diagnostics)
export { StreamTimingTracker, SLOW_CHUNK_GAP_THRESHOLD_MS } from './stream-timing-tracker.js'
export type { StreamTimingData, StreamTimingDeps } from './stream-timing-tracker.js'

// Chunk timeout guard (shared by WS + SSE transports)
export { ChunkTimeoutGuard, DEFAULT_CHUNK_TIMEOUT_MS, CHUNK_GAP_WARNING_THRESHOLDS_MS } from './chunk-timeout-guard.js'
export type { ChunkTimeoutDeps } from './chunk-timeout-guard.js'
export { decideChunkTimeoutFinalization } from './chunk-timeout-finalization.js'
export type { ChunkTimeoutOutcome } from './chunk-timeout-finalization.js'

// Tool-frame metadata resolution (shared by WS + SSE transports)
export { toolMetadataFields } from './tool-metadata.js'
export type { ResolveToolMetadata, ToolMetadataLogger } from './tool-metadata.js'

// Skill output redaction (shared by WS + SSE transports before emitting tool-result)
export { redactSkillOutput } from './redact-skill-output.js'

// Incremental turn snapshot tracking (shared by WS + SSE persistence/recovery)
export {
  buildInvocationToolResponseData,
  buildToolResponseData,
  buildToolResponseDataFromSnapshot,
  extractTurnOutputFromEvents,
  extractTurnToolResponseDataFromEvents,
  trackTurnSnapshotEvent,
} from './turn-snapshot-tracker.js'
export type {
  InitializedTurnSnapshotState,
  ToolResponseDataEntry,
  TurnSnapshotContentSegment,
  TurnSnapshotSegment,
  TurnSnapshotState,
  TurnSnapshotToolCall,
  TurnSnapshotToolCallSegment,
  TurnSnapshotTrackResult,
  TurnSnapshotUpdate,
} from './turn-snapshot-tracker.js'

// Non-idempotent tool detection (for mid-stream budget retry decisions)
export { hasNonIdempotentTools } from './non-idempotent-tools.js'

// Mid-stream budget recovery (shared by WS + SSE transports)
export { withBudgetRecovery, invokeBudgetRecoveryCallback, buildContinuationPrompt, MAX_BUDGET_RETRIES, BudgetRecoveryTimeoutError } from './budget-recovery.js'
export type { BudgetRecoveryCallback, BudgetRecoveryResult, BudgetRecoveryStreamOptions } from './budget-recovery.js'

// OTel trace/span ID capture (for correlating client feedback to Langfuse)
export { getCurrentTraceIds } from './observability/otel-trace-ids.js'
export type { TraceIds } from './observability/otel-trace-ids.js'

// Signals + OTEL trace context for chat transports (WS handshake, SSE request)
export {
  buildChatSignalsTraceContext,
  BUSINESS_CONTEXT_SCHEMA_ID,
} from './observability/signals-trace-context.js'
export type {
  ChatSignalsTraceLogPrefix,
  ChatSignalsTraceLogger,
  JwtAgentContextSubset,
} from './observability/signals-trace-context.js'

// LLM provider inference for OTEL invocation spans
export { inferProviderFromModelName } from './observability/infer-llm-provider.js'
export type { ChatLlmProvider } from './observability/infer-llm-provider.js'

// Turn-level error classification (shared by WS catch block + SSE outer catch).
export { analyzeStreamError, isNetworkError, isUpstreamTimeoutError } from './analyze-stream-error.js'
export type { AnalyzedStreamError } from './analyze-stream-error.js'
export { classifyTurnError } from './classify-turn-error.js'
export type { ClassifiedTurnError, TurnErrorType } from './classify-turn-error.js'
export { classifyStreamBudgetError, isToolValidationError } from './classify-stream-error.js'
export type { StreamBudgetErrorResult, BudgetErrorSource } from './classify-stream-error.js'

// Turn-level observability primitives (invocation span + error emission).
export {
  AGENT_SERVICE_ID,
  AGENT_SERVICE_NAME,
  MULTI_AGENT_SYSTEM,
} from './observability/agent-identity.js'
export { recordTokenUsageObservability } from './token-usage-observability.js'
export type {
  TokenUsageObservabilityParams,
  TokenUsageObservabilityResult,
  TokenUsageObservabilityLogger,
  TokenUsageApmTracker,
} from './token-usage-observability.js'
export { emitTurnError, createAgentInvocation, createAgentTurn, runAgentTurnSpan } from './observability/agent-invocation.js'
export { addSkillNameToSpan } from './observability/agent-invocation-context.js'
export type {
  EmitTurnErrorOptions,
  TurnErrorLogger,
  AgentInvocationHandle,
  AgentInvocationOptions,
  AgentTurnHandle,
  AgentTurnOptions,
  AgentTurnSpanOptions,
  InvocationEndSuccess,
  InvocationUsage,
  AgentForInvocation,
  TurnEndFields,
  TurnExecutionResult,
} from './observability/agent-invocation.js'

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

// Payload size measurement (shared by WS + SSE size-limit checks)
export { stringPayloadLength } from './payload-length.js'

export { runPreflightTools } from './preflight-tools.js'
export type { RunPreflightToolsInput } from './preflight-tools.js'
