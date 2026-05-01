import type { ToolCall } from '@/stores/useStreamingConversationStore'

export function mapToolStart(tool: { id?: string; name: string; input?: Record<string, unknown> }): ToolCall {
  return {
    id: tool.id || `tool_${Date.now()}`,
    name: tool.name,
    input: tool.input || {},
    status: 'running',
    startTime: Date.now(),
  }
}

export function mapToolCall(tool: { id: string; name: string; input?: Record<string, unknown> }): ToolCall {
  return {
    id: tool.id,
    name: tool.name,
    input: tool.input || {},
    status: 'running',
  }
}

export function mapToolResult(tool: {
  id: string; name: string; input?: Record<string, unknown>
  output?: unknown; result?: unknown; error?: string; is_error?: boolean
  startTime?: number
}): ToolCall {
  const hasError = tool.error || tool.is_error
  return {
    id: tool.id,
    name: tool.name,
    input: tool.input || {},
    result: (tool.output || tool.result) as Record<string, unknown> | string | undefined,
    error: tool.error,
    status: hasError ? 'error' : 'completed',
    startTime: tool.startTime,
    endTime: Date.now(),
  }
}
