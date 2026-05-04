/**
 * Shared types for agent conversation messages and tool calls.
 *
 * These mirror (a subset of) the shapes produced by the agents service
 * `/agent/conversations/...` endpoints. Kept narrow on purpose - the debug
 * console only consumes a few fields.
 */

export interface ToolCall {
    id: string;
    name: string;
    input?: unknown;
    result?: unknown;
    status?: string;
    startTime?: string;
    endTime?: string;
    duration?: number;
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
