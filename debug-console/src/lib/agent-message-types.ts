/**
 * Shared types for agent conversation messages and tool calls.
 *
 * These mirror (a subset of) the shapes produced by the agents service
 * `/agent/conversations/...` endpoints. Kept narrow on purpose - the debug
 * console only consumes a few fields.
 */

export interface ToolCall {
    id: string;
    // Display-shape fields (used by renderers and ToolCallRow)
    name: string;
    input?: unknown;
    result?: unknown;
    duration?: number;
    // Wire-format aliases returned by the agents service
    toolName?: string;
    toolArgs?: unknown;
    toolResult?: unknown;
    durationMs?: number;
    // Common to both shapes
    status?: string;
    startTime?: string;
    endTime?: string;
}

/** Normalise a tool call from wire format (toolName/toolArgs) to display format (name/input). */
export function normalizeToolCall(raw: ToolCall): ToolCall {
    return {
        ...raw,
        name: raw.name ?? raw.toolName ?? 'unknown',
        input: raw.input ?? raw.toolArgs,
        result: raw.result ?? raw.toolResult,
        duration: raw.duration ?? raw.durationMs,
    };
}

// Streaming segment captured per agent message. Each segment is either a chunk
// of streamed text content or a reference to a tool call. Segments are
// chronological — the ordering mirrors how the LLM emitted them.
export interface MessageSegment {
    id: string;
    type: 'content' | 'tool_call' | string;
    timestamp?: string;
    content?: string;
    toolCall?: ToolCall;
}
