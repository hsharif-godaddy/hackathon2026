import { randomUUID } from 'node:crypto'
import type { PersistenceStreamingEvent } from './interfaces.js'

export interface TurnSnapshotToolCall {
  id: string
  name: string
  input: unknown
  status: 'running' | 'completed' | 'error'
  startTime: Date
  result?: unknown
  error?: string
  endTime?: Date
  duration?: number
}

export interface TurnSnapshotContentSegment {
  id: string
  type: 'content'
  content: string
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface TurnSnapshotToolCallSegment {
  id: string
  type: 'tool_call'
  timestamp: Date
  toolCall: TurnSnapshotToolCall
}

export type TurnSnapshotSegment = TurnSnapshotContentSegment | TurnSnapshotToolCallSegment

export interface TurnSnapshotState {
  streamingEvents: PersistenceStreamingEvent[]
  pendingSegments?: TurnSnapshotSegment[]
  pendingToolCalls?: Map<string, TurnSnapshotToolCall>
  accumulatedContent?: string
}

export interface InitializedTurnSnapshotState extends TurnSnapshotState {
  pendingSegments: TurnSnapshotSegment[]
  pendingToolCalls: Map<string, TurnSnapshotToolCall>
  accumulatedContent: string
}

export interface TurnSnapshotUpdate {
  content: string
  segments: TurnSnapshotSegment[]
  toolCalls: TurnSnapshotToolCall[]
}

export interface TurnSnapshotTrackResult {
  event: PersistenceStreamingEvent
  shouldUpdateAgentTurn: boolean
  update: TurnSnapshotUpdate
}

function initializeTurnSnapshotState(state: TurnSnapshotState): asserts state is InitializedTurnSnapshotState {
  if (!state.pendingSegments) {
    state.pendingSegments = []
  }
  if (!state.pendingToolCalls) {
    state.pendingToolCalls = new Map()
  }
  if (!state.accumulatedContent) {
    state.accumulatedContent = ''
  }
}

function createSegmentId(): string {
  return `seg_${randomUUID()}`
}

function isTextEvent(type: string): boolean {
  return type === 'chunk' || type === 'text_chunk'
}

function asToolStart(data: Record<string, unknown>): { id?: string; name: string; input: unknown } | null {
  const tool = data.tool
  if (!tool || typeof tool !== 'object') return null
  const record = tool as Record<string, unknown>
  if (typeof record.name !== 'string') return null
  return {
    ...(typeof record.id === 'string' && { id: record.id }),
    name: record.name,
    input: record.input,
  }
}

function asToolResult(data: Record<string, unknown>): {
  id: string
  name?: string
  input?: unknown
  output?: unknown
  result?: unknown
  error?: string
  is_error?: boolean
} | null {
  const tool = data.tool
  if (!tool || typeof tool !== 'object') return null
  const record = tool as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  return {
    id: record.id,
    ...(typeof record.name === 'string' && { name: record.name }),
    ...(record.input !== undefined && { input: record.input }),
    ...(record.output !== undefined && { output: record.output }),
    ...(record.result !== undefined && { result: record.result }),
    ...(typeof record.error === 'string' && { error: record.error }),
    ...(typeof record.is_error === 'boolean' && { is_error: record.is_error }),
  }
}

function buildUpdate(state: InitializedTurnSnapshotState): TurnSnapshotUpdate {
  return {
    content: state.accumulatedContent,
    segments: [...state.pendingSegments],
    toolCalls: Array.from(state.pendingToolCalls.values()),
  }
}

/**
 * Updates the in-memory turn snapshot used by both transports for final
 * persistence and incremental `updateAgentTurn` recovery state.
 */
export function trackTurnSnapshotEvent(
  state: TurnSnapshotState,
  type: string,
  content: string,
  data: Record<string, unknown>,
): TurnSnapshotTrackResult {
  const timestamp = new Date()
  const event: PersistenceStreamingEvent = {
    type,
    content: content || undefined,
    data,
    timestamp,
  }

  state.streamingEvents.push(event)
  initializeTurnSnapshotState(state)

  if (isTextEvent(type) && content) {
    const lastEvent = state.streamingEvents[state.streamingEvents.length - 2]
    if (state.accumulatedContent && lastEvent && !isTextEvent(lastEvent.type)) {
      state.accumulatedContent += '\n'
    }
    state.accumulatedContent += content
    state.pendingSegments.push({
      id: createSegmentId(),
      type: 'content',
      content,
      timestamp,
    })
  } else if (type === 'tool_start') {
    const tool = asToolStart(data)
    if (tool) {
      const toolId = tool.id || `tool_${randomUUID()}`
      const toolData: TurnSnapshotToolCall = {
        id: toolId,
        name: tool.name,
        input: tool.input,
        status: 'running',
        startTime: timestamp,
      }
      state.pendingToolCalls.set(toolId, toolData)
      state.pendingSegments.push({
        id: createSegmentId(),
        type: 'tool_call',
        timestamp,
        toolCall: toolData,
      })
    }
  } else if (type === 'tool_result') {
    const tool = asToolResult(data)
    if (tool) {
      const existingTool = state.pendingToolCalls.get(tool.id) ?? {
        id: tool.id,
        name: tool.name ?? tool.id,
        input: tool.input,
        status: 'running' as const,
        startTime: timestamp,
      }
      existingTool.name = tool.name ?? existingTool.name
      existingTool.input = tool.input ?? existingTool.input
      existingTool.result = tool.output ?? content ?? tool.result
      if (tool.error !== undefined) {
        existingTool.error = tool.error
      } else {
        delete existingTool.error
      }
      existingTool.status = (tool.error || tool.is_error) ? 'error' : 'completed'
      existingTool.endTime = timestamp
      existingTool.duration = timestamp.getTime() - new Date(existingTool.startTime).getTime()
      state.pendingToolCalls.set(tool.id, existingTool)

      const segment = state.pendingSegments.find(s =>
        s.type === 'tool_call' && s.toolCall.id === tool.id
      )
      if (segment?.type === 'tool_call') {
        segment.toolCall = existingTool
      } else {
        state.pendingSegments.push({
          id: createSegmentId(),
          type: 'tool_call',
          timestamp,
          toolCall: existingTool,
        })
      }
    }
  }

  return {
    event,
    shouldUpdateAgentTurn: type === 'tool_result' && !!asToolResult(data),
    update: buildUpdate(state),
  }
}

/** Derive user-visible text for an entire turn by replaying streamed events.
 *  SSE keeps one `streamingEvents` array for the full turn (including handoffs);
 *  use this at the turn boundary instead of the final iteration's snapshot alone. */
export function extractTurnOutputFromEvents(events: ReadonlyArray<PersistenceStreamingEvent>): string {
  let accumulated = ''
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (!event) continue
    const content = event.content ?? ''
    if (!isTextEvent(event.type) || !content) continue
    const previous = i > 0 ? events[i - 1] : undefined
    if (accumulated && previous && !isTextEvent(previous.type)) {
      accumulated += '\n'
    }
    accumulated += content
  }
  return accumulated
}

/** Structured tool payload shape shared by invocation-end and turn-end events. */
export interface ToolResponseDataEntry {
  name: string
  status: string
  output?: unknown
}

/** Map turn snapshot tool calls to observability `responseData`. Returns
 *  undefined when there are no tool results (callers omit the field). */
export function buildToolResponseData(
  toolCalls: Iterable<TurnSnapshotToolCall>,
): ToolResponseDataEntry[] | undefined {
  const entries: ToolResponseDataEntry[] = []
  for (const tool of toolCalls) {
    entries.push({
      name: tool.name,
      status: tool.status,
      ...(tool.result !== undefined && { output: tool.result }),
      ...(tool.error !== undefined && tool.result === undefined && { output: tool.error }),
    })
  }
  return entries.length > 0 ? entries : undefined
}

/** Build responseData from a turn snapshot's pending tool-call map. */
export function buildToolResponseDataFromSnapshot(
  state: TurnSnapshotState,
): ToolResponseDataEntry[] | undefined {
  if (!state.pendingToolCalls || state.pendingToolCalls.size === 0) return undefined
  return buildToolResponseData(state.pendingToolCalls.values())
}

/** Replay tool events from a turn's streaming log and derive responseData.
 *  SSE keeps one event array for the full turn (including handoffs). */
export function extractTurnToolResponseDataFromEvents(
  events: ReadonlyArray<PersistenceStreamingEvent>,
): ToolResponseDataEntry[] | undefined {
  const state: TurnSnapshotState = { streamingEvents: [] }
  for (const event of events) {
    if (event.type !== 'tool_start' && event.type !== 'tool_result') continue
    trackTurnSnapshotEvent(
      state,
      event.type,
      event.content ?? '',
      (event.data ?? {}) as Record<string, unknown>,
    )
  }
  return buildToolResponseDataFromSnapshot(state)
}

/** Tool calls added to `snapshot` after `toolIdsBefore` (one agent invocation). */
export function buildInvocationToolResponseData(
  snapshot: TurnSnapshotState,
  toolIdsBefore: ReadonlySet<string>,
): ToolResponseDataEntry[] | undefined {
  if (!snapshot.pendingToolCalls || snapshot.pendingToolCalls.size === 0) return undefined
  return buildToolResponseData(
    Array.from(snapshot.pendingToolCalls.values()).filter((tool) => !toolIdsBefore.has(tool.id)),
  )
}
