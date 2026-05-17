import type { ToolCall } from '../database/schema.js';

export interface UIToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  status: string;
  error?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

export function mapToolCallToUI(tc: Partial<ToolCall> & Record<string, unknown>): UIToolCall {
  return {
    id: tc.id as string,
    name: (tc.toolName as string) || (tc.name as string) || 'unknown',
    input: tc.toolArgs ?? tc.input ?? {},
    result: tc.toolResult ?? tc.result,
    status: tc.status as string,
    error: tc.error as string | undefined,
    startTime: tc.startTime as number | undefined,
    endTime: tc.endTime as number | undefined,
    duration: (tc.durationMs as number) ?? (tc.duration as number),
  };
}

export function mapToolCallsToUI(toolCalls: Array<Partial<ToolCall> & Record<string, unknown>>): UIToolCall[] {
  return toolCalls.map(mapToolCallToUI);
}
