import { describe, it, expect } from 'vitest';
import { extractConversationItems, type Session } from '../LangfusePanel';

// Helper to build a minimal Session with typed observations
function makeSession(overrides: {
  sessionId?: string;
  traces: Array<{
    id: string;
    name?: string;
    timestamp?: string;
    input?: { messages?: Array<{ role: 'user' | 'assistant' | 'tool' | 'system'; content: string }> } | string | null;
    output?: unknown;
    observations?: Array<{
      id: string;
      name: string;
      type: string;
      startTime?: string;
      endTime?: string;
      parentObservationId?: string;
      level?: string;
      statusMessage?: string;
      input?: unknown;
      output?: unknown;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      metadata?: { attributes?: Record<string, unknown>; [key: string]: unknown };
    }>;
  }>;
}): Session {
  return {
    sessionId: overrides.sessionId || 'session-1',
    firstTrace: overrides.traces[0]?.timestamp || '2025-01-01T00:00:00Z',
    lastTrace: overrides.traces[overrides.traces.length - 1]?.timestamp || '2025-01-01T00:00:00Z',
    traceCount: overrides.traces.length,
    traces: overrides.traces.map(t => ({
      id: t.id,
      name: t.name || 'agent-planner',
      timestamp: t.timestamp || '2025-01-01T00:00:00Z',
      tags: [] as string[],
      input: t.input ?? null,
      output: t.output ?? null,
      metadata: null,
      observations: (t.observations || []).map(obs => ({
        model: undefined,
        calculatedInputCost: undefined,
        calculatedOutputCost: undefined,
        calculatedTotalCost: undefined,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        ...obs,
      })),
    })),
  };
}

describe('extractConversationItems', () => {
  describe('agentSteps construction', () => {
    it('builds multi-step agentSteps from multiple agent GENERATIONs', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-planner', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: 'Step 1 text', tool_calls: JSON.stringify([{ toolName: 'readFile', toolCallId: 'tc-1', input: { filePath: '/a.ts' } }]) },
            },
            {
              id: 'tool-1', name: 'readFile', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:03Z',
              parentObservationId: 'gen-1',
              input: { filePath: '/a.ts' }, output: 'file contents',
              metadata: { attributes: { 'ai.toolCall.id': 'tc-1' } },
            },
            {
              id: 'gen-2', name: 'agent-planner', type: 'GENERATION',
              startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:04Z',
              output: { content: 'Step 2 text' },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant!.agentSteps).toBeDefined();
      expect(assistant!.agentSteps).toHaveLength(2);

      // Step 1: text + tool call
      expect(assistant!.agentSteps![0].text).toBe('Step 1 text');
      expect(assistant!.agentSteps![0].toolCalls).toHaveLength(1);
      expect(assistant!.agentSteps![0].toolCalls[0].name).toBe('readFile');
      expect(assistant!.agentSteps![0].toolCalls[0].result).toBe('file contents');
      expect(assistant!.agentSteps![0].toolCalls[0].success).toBe(true);

      // Step 2: text only
      expect(assistant!.agentSteps![1].text).toBe('Step 2 text');
      expect(assistant!.agentSteps![1].toolCalls).toHaveLength(0);
    });

    it('does not create agentSteps for single generation without tools', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-planner', type: 'GENERATION',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'Just text, no tools' },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant!.agentSteps).toBeUndefined();
    });
  });

  describe('tool matching strategies', () => {
    it('matches tool by toolCallId (strategy 1)', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: '', tool_calls: JSON.stringify([{ toolName: 'readFile', toolCallId: 'tc-abc', input: {} }]) },
            },
            {
              id: 'tool-1', name: 'readFile', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:03Z',
              // No parentObservationId — must match by toolCallId
              output: 'matched-by-id',
              metadata: { attributes: { 'ai.toolCall.id': 'tc-abc' } },
            },
            // Dummy second gen to trigger agentSteps
            {
              id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:04Z',
              output: { content: 'done' },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const step = items.find(i => i.type === 'assistant')!.agentSteps![0];
      expect(step.toolCalls[0].result).toBe('matched-by-id');
    });

    it('matches tool by parentObservationId + name (strategy 2)', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: '', tool_calls: JSON.stringify([{ toolName: 'writeFile', input: {} }]) },
            },
            {
              id: 'tool-1', name: 'writeFile', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:03Z',
              parentObservationId: 'gen-1',
              output: 'matched-by-parent',
            },
            {
              id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:04Z',
              output: { content: 'done' },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const step = items.find(i => i.type === 'assistant')!.agentSteps![0];
      expect(step.toolCalls[0].result).toBe('matched-by-parent');
    });

    it('matches tool by time-window fallback (strategy 3) when parent does not match', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: '', tool_calls: JSON.stringify([{ toolName: 'grepSearch', input: {} }]) },
            },
            {
              id: 'tool-1', name: 'grepSearch', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:03Z',
              parentObservationId: 'some-span-wrapper', // parented to a SPAN, not the generation
              output: 'matched-by-timewindow',
            },
            {
              id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:04Z', endTime: '2025-01-01T00:00:05Z',
              output: { content: 'done' },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const step = items.find(i => i.type === 'assistant')!.agentSteps![0];
      expect(step.toolCalls[0].result).toBe('matched-by-timewindow');
    });

    it('marks failed tools with success=false', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: '', tool_calls: JSON.stringify([{ toolName: 'terminalCommand', toolCallId: 'tc-1', input: {} }]) },
            },
            {
              id: 'tool-1', name: 'terminalCommand', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:03Z',
              parentObservationId: 'gen-1',
              level: 'ERROR',
              statusMessage: 'Command failed with exit code 1',
              output: null,
              metadata: { attributes: { 'ai.toolCall.id': 'tc-1' } },
            },
            {
              id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:04Z',
              output: { content: 'done' },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const tc = items.find(i => i.type === 'assistant')!.agentSteps![0].toolCalls[0];
      expect(tc.success).toBe(false);
      expect(tc.statusMessage).toBe('Command failed with exit code 1');
    });

    it('does not double-match the same TOOL observation to multiple tool calls', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: {
                content: '',
                tool_calls: JSON.stringify([
                  { toolName: 'readFile', toolCallId: 'tc-1', input: { filePath: '/a.ts' } },
                  { toolName: 'readFile', toolCallId: 'tc-2', input: { filePath: '/b.ts' } },
                ]),
              },
            },
            {
              id: 'tool-1', name: 'readFile', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:02.5Z',
              parentObservationId: 'gen-1', output: 'file-a',
              metadata: { attributes: { 'ai.toolCall.id': 'tc-1' } },
            },
            {
              id: 'tool-2', name: 'readFile', type: 'TOOL',
              startTime: '2025-01-01T00:00:02.5Z', endTime: '2025-01-01T00:00:03Z',
              parentObservationId: 'gen-1', output: 'file-b',
              metadata: { attributes: { 'ai.toolCall.id': 'tc-2' } },
            },
            {
              id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:04Z',
              output: { content: 'done' },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const tcs = items.find(i => i.type === 'assistant')!.agentSteps![0].toolCalls;
      expect(tcs).toHaveLength(2);
      expect(tcs[0].result).toBe('file-a');
      expect(tcs[1].result).toBe('file-b');
    });
  });

  describe('summarization deduplication', () => {
    it('does not deduplicate summarization traces with the same step count', () => {
      const session = makeSession({
        traces: [
          {
            id: 'trace-sum-1', name: 'summarization-1',
            timestamp: '2025-01-01T00:00:01Z',
            observations: [{
              id: 'gen-s1', name: 'summarization-chunk', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: 'summary A' }, promptTokens: 100, completionTokens: 50,
            }],
          },
          {
            id: 'trace-sum-2', name: 'summarization-2',
            timestamp: '2025-01-01T00:00:05Z',
            observations: [{
              id: 'gen-s2', name: 'summarization-chunk', type: 'GENERATION',
              startTime: '2025-01-01T00:00:05Z', endTime: '2025-01-01T00:00:06Z',
              output: { content: 'summary B' }, promptTokens: 100, completionTokens: 50,
            }],
          },
        ],
      });

      const items = extractConversationItems([session]);
      const summItems = items.filter(i => i.type === 'summarization');
      expect(summItems).toHaveLength(2);
      expect(summItems[0].traceId).toBe('trace-sum-1');
      expect(summItems[1].traceId).toBe('trace-sum-2');
    });
  });

  describe('observation error filtering', () => {
    it('includes non-TOOL errors in observationErrors with obsType', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: 'response text' },
              level: 'ERROR', statusMessage: 'Generation failed',
            },
            {
              id: 'span-1', name: 'rag-retrieval', type: 'SPAN',
              startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T00:00:01Z',
              level: 'ERROR', statusMessage: 'Retrieval timeout',
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant!.observationErrors).toHaveLength(2);
      expect(assistant!.observationErrors![0]).toEqual({
        name: 'agent-dev', message: 'Generation failed', obsType: 'GENERATION',
      });
      expect(assistant!.observationErrors![1]).toEqual({
        name: 'rag-retrieval', message: 'Retrieval timeout', obsType: 'SPAN',
      });
    });
  });

  describe('generation sorting with missing timestamps', () => {
    it('handles missing startTime by using endTime as fallback', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          timestamp: '2025-01-01T00:00:00Z',
          input: { messages: [{ role: 'user', content: 'test' }] },
          observations: [
            {
              id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
              // No startTime, only endTime
              endTime: '2025-01-01T00:00:04Z',
              output: { content: 'second step' },
            },
            {
              id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
              output: { content: 'first step', tool_calls: JSON.stringify([{ toolName: 'readFile', input: {} }]) },
            },
            {
              id: 'tool-1', name: 'readFile', type: 'TOOL',
              startTime: '2025-01-01T00:00:02Z', endTime: '2025-01-01T00:00:03Z',
              parentObservationId: 'gen-1', output: 'ok',
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const steps = items.find(i => i.type === 'assistant')!.agentSteps!;
      // gen-1 (startTime 00:01) should come before gen-2 (endTime 00:04)
      expect(steps[0].text).toBe('first step');
      expect(steps[1].text).toBe('second step');
    });
  });
});
