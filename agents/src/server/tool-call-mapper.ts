import type { ToolCall } from '../database/schema.js';

export interface UIToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  status: WireStatus;
  error?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

// DB canonicalizes successful tool calls as 'success'; the live wire format uses
// 'completed'. Translate at this boundary so reload-rendered tool calls match the
// in-flight shape that client renderers gate on.
type DbStatus = 'running' | 'success' | 'error';
type WireStatus = 'running' | 'completed' | 'error';

function mapStatusToUI(status: DbStatus | undefined): WireStatus | undefined {
  return status === 'success' ? 'completed' : status;
}

export function mapToolCallToUI(tc: Partial<ToolCall> & Record<string, unknown>): UIToolCall {
  return {
    id: tc.id as string,
    name: (tc.toolName as string) || (tc.name as string) || 'unknown',
    input: tc.toolArgs ?? tc.input ?? {},
    result: tc.toolResult ?? tc.result,
    status: mapStatusToUI(tc.status as DbStatus | undefined) ?? 'running',
    error: tc.error as string | undefined,
    startTime: tc.startTime as number | undefined,
    endTime: tc.endTime as number | undefined,
    duration: (tc.durationMs as number) ?? (tc.duration as number),
  };
}

export function mapToolCallsToUI(toolCalls: Array<Partial<ToolCall> & Record<string, unknown>>): UIToolCall[] {
  return toolCalls.map(mapToolCallToUI);
}

// Segments arrive from `ConversationRepository.normalizeSegments`, which mirrors the
// nested tool call onto BOTH `toolCall` (camelCase) and `tool_call` (snake_case) for
// back-compat. Patch the status on whichever keys are present rather than rebuilding
// the segment — the segment shape is loose and may carry caller-specific extras
// (timestamp, content, future fields) that we should not drop.
type SegmentToolCall = Record<string, unknown> & { status?: DbStatus | WireStatus };
type Segment = Record<string, unknown> & {
  toolCall?: SegmentToolCall;
  tool_call?: SegmentToolCall;
};

function mapSegmentToolCall(tc: SegmentToolCall): SegmentToolCall {
  // tc.status may be either DbStatus (post-DB load) or already a WireStatus (live
  // event passed through). mapStatusToUI is a no-op for the latter — only 'success'
  // changes — so the cast is safe.
  const wireStatus = mapStatusToUI(tc.status as DbStatus | undefined);
  return wireStatus === undefined ? tc : { ...tc, status: wireStatus };
}

export function mapSegmentsToUI(segments: Segment[]): Segment[] {
  return segments.map((segment) => {
    if (segment.toolCall == null && segment.tool_call == null) {
      return segment;
    }
    const next: Segment = { ...segment };
    if (segment.toolCall != null) {
      next.toolCall = mapSegmentToolCall(segment.toolCall);
    }
    if (segment.tool_call != null) {
      next.tool_call = mapSegmentToolCall(segment.tool_call);
    }
    return next;
  });
}
