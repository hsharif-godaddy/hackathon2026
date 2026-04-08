import { describe, it, expect } from 'vitest';
import { extractConversationItems, computeSessionTotals, type Session } from '../LangfusePanel';

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
      model?: string;
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
      calculatedTotalCost?: number;
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

  describe('cost estimation', () => {
    it('uses client-side estimate when model is in ANTHROPIC_PRICING and cache tokens present', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-5-20250929',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 10000,
            completionTokens: 500,
            calculatedTotalCost: 0.01, // Langfuse's (wrong) cost
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-5-20250929',
                'ai.usage.cachedInputTokens': '8000',
                'ai.response.providerMetadata': JSON.stringify({
                  anthropic: { cacheCreationInputTokens: 1000 },
                }),
              },
            },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant!.cost).toBeDefined();
      // AI SDK inputTokens (10000) = raw_input + cache_creation + cache_read
      // regularInput = 10000 - 8000 (cacheRead) - 1000 (cacheWrite) = 1000
      // Expected: 1000*3/1M + 8000*0.30/1M + 1000*3.75/1M + 500*15/1M
      //         = 0.003 + 0.0024 + 0.00375 + 0.0075 = 0.01665
      expect(assistant!.cost).toBeCloseTo(0.01665, 5);
      // Must NOT be Langfuse's 0.01
      expect(assistant!.cost).not.toBeCloseTo(0.01, 4);
    });

    it('falls back to Langfuse calculatedTotalCost when model is not in pricing table', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'some-unknown-model',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 1000,
            completionTokens: 100,
            calculatedTotalCost: 0.05,
            metadata: { attributes: { 'ai.model.id': 'some-unknown-model' } },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant!.cost).toBe(0.05);
    });

    it('parses cacheReadInputTokens from ai.usage.cachedInputTokens attribute', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 5000,
            completionTokens: 200,
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-6',
                'ai.usage.cachedInputTokens': JSON.stringify({ intValue: 4000 }),
              },
            },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant!.cacheReadInputTokens).toBe(4000);
    });

    it('parses cacheWriteInputTokens from providerMetadata', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 5000,
            completionTokens: 200,
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-6',
                'ai.response.providerMetadata': JSON.stringify({
                  anthropic: { cacheCreationInputTokens: 3000 },
                }),
              },
            },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant!.cacheWriteInputTokens).toBe(3000);
    });

    it('does not double-count cache reads when AI SDK attribute is present but zero', () => {
      // When ai.usage.cachedInputTokens is present (even as 0), providerMetadata
      // cache reads must NOT be used — prevents double-counting.
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 5000,
            completionTokens: 200,
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-6',
                'ai.usage.cachedInputTokens': 0, // present but zero
                'ai.response.providerMetadata': JSON.stringify({
                  anthropic: {
                    cacheCreationInputTokens: 500,
                    cacheReadInputTokens: 3000, // should NOT be picked up
                  },
                }),
              },
            },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      // cacheRead should be 0 (from AI SDK), NOT 3000 (from providerMetadata fallback)
      expect(assistant!.cacheReadInputTokens).toBeUndefined();
      expect(assistant!.cacheWriteInputTokens).toBe(500);
    });

    it('uses providerMetadata cache reads as fallback when AI SDK attribute absent', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 5000,
            completionTokens: 200,
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-6',
                // NO ai.usage.cachedInputTokens attribute
                'ai.response.providerMetadata': JSON.stringify({
                  anthropic: {
                    cacheCreationInputTokens: 500,
                    cacheReadInputTokens: 3000,
                  },
                }),
              },
            },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      // Should fall back to providerMetadata reads
      expect(assistant!.cacheReadInputTokens).toBe(3000);
      expect(assistant!.cacheWriteInputTokens).toBe(500);
    });

    it('returns 0 cost for recognized model with zero tokens (does not fall back to Langfuse)', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [{
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            output: { content: 'response' },
            promptTokens: 0,
            completionTokens: 0,
            calculatedTotalCost: 0.99, // Should NOT be used
            metadata: { attributes: { 'ai.model.id': 'claude-sonnet-4-6' } },
          }],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant!.cost).toBe(0);
    });
  });

  describe('per-step cost', () => {
    it('populates cost on each agentStep using per-generation cache tokens', () => {
      const session = makeSession({
        traces: [{
          id: 'trace-1',
          input: { messages: [{ role: 'user', content: 'hello' }] },
          observations: [
            {
              id: 'gen-1', name: 'agent-dev:ai.streamText.doStream', type: 'GENERATION',
              model: 'claude-sonnet-4-6',
              startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:03Z',
              output: { content: 'step 1 text', tool_calls: JSON.stringify([{ toolName: 'readFile', input: {} }]) },
              promptTokens: 10000, completionTokens: 200,
              metadata: {
                attributes: {
                  'ai.model.id': 'claude-sonnet-4-6',
                  'ai.usage.cachedInputTokens': 8000,
                  'ai.response.providerMetadata': JSON.stringify({ anthropic: { cacheCreationInputTokens: 500 } }),
                },
              },
            },
            {
              id: 'tool-1', name: 'readFile', type: 'TOOL',
              parentObservationId: 'gen-1',
              startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:03.1Z',
              output: 'file contents',
            },
            {
              id: 'gen-2', name: 'agent-dev:ai.streamText.doStream', type: 'GENERATION',
              model: 'claude-sonnet-4-6',
              startTime: '2025-01-01T00:00:04Z', endTime: '2025-01-01T00:00:06Z',
              output: { content: 'step 2 text' },
              promptTokens: 12000, completionTokens: 500,
              metadata: {
                attributes: {
                  'ai.model.id': 'claude-sonnet-4-6',
                  'ai.usage.cachedInputTokens': 10000,
                  'ai.response.providerMetadata': JSON.stringify({ anthropic: { cacheCreationInputTokens: 1000 } }),
                },
              },
            },
          ],
        }],
      });

      const items = extractConversationItems([session]);
      const assistant = items.find(i => i.type === 'assistant');
      expect(assistant!.agentSteps).toBeDefined();
      expect(assistant!.agentSteps!.length).toBe(2);

      const step1 = assistant!.agentSteps![0];
      const step2 = assistant!.agentSteps![1];

      // Step 1: regularIn = 10000-8000-500=1500, cost = 1500*3 + 8000*0.3 + 500*3.75 + 200*15 = 4500+2400+1875+3000 = 11775 / 1M
      expect(step1.inputTokens).toBe(10000);
      expect(step1.cost).toBeCloseTo(0.011775, 5);

      // Step 2: regularIn = 12000-10000-1000=1000, cost = 1000*3 + 10000*0.3 + 1000*3.75 + 500*15 = 3000+3000+3750+7500 = 17250 / 1M
      expect(step2.inputTokens).toBe(12000);
      expect(step2.cost).toBeCloseTo(0.01725, 5);

      // Per-step costs should sum to trace-level cost
      expect(step1.cost! + step2.cost!).toBeCloseTo(assistant!.cost!, 5);
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

describe('computeSessionTotals', () => {
  it('accumulates cacheWriteInputTokens across multiple generations', () => {
    const session = makeSession({
      traces: [{
        id: 'trace-1',
        observations: [
          {
            id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
            promptTokens: 10000, completionTokens: 200,
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-6',
                'ai.usage.cachedInputTokens': 8000,
                'ai.response.providerMetadata': JSON.stringify({
                  anthropic: { cacheCreationInputTokens: 500 },
                }),
              },
            },
          },
          {
            id: 'gen-2', name: 'agent-dev', type: 'GENERATION',
            model: 'claude-sonnet-4-6',
            startTime: '2025-01-01T00:00:03Z', endTime: '2025-01-01T00:00:04Z',
            promptTokens: 12000, completionTokens: 300,
            metadata: {
              attributes: {
                'ai.model.id': 'claude-sonnet-4-6',
                'ai.usage.cachedInputTokens': 10000,
                'ai.response.providerMetadata': JSON.stringify({
                  anthropic: { cacheCreationInputTokens: 1500 },
                }),
              },
            },
          },
          {
            id: 'span-1', name: 'some-span', type: 'SPAN',
            startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T00:00:05Z',
            promptTokens: 99999, // Should be ignored — not a GENERATION
          },
        ],
      }],
    });

    const totals = computeSessionTotals([session]);

    expect(totals.cacheWriteInputTokens).toBe(2000); // 500 + 1500
    expect(totals.cachedInputTokens).toBe(18000);     // 8000 + 10000
    expect(totals.inputTokens).toBe(22000);            // 10000 + 12000 (only GENERATIONs)
    expect(totals.outputTokens).toBe(500);             // 200 + 300
    expect(totals.traceCount).toBe(1);
    expect(totals.observationCount).toBe(3);           // 2 GEN + 1 SPAN counted
    // Cost uses corrected formula: regularIn = promptTokens - cacheRead - cacheWrite
    // gen-1: (10000-8000-500)*3 + 8000*0.3 + 500*3.75 + 200*15 = 4500+2400+1875+3000 = 11775
    // gen-2: (12000-10000-1500)*3 + 10000*0.3 + 1500*3.75 + 300*15 = 1500+3000+5625+4500 = 14625
    // total = 26400 / 1M = 0.0264
    expect(totals.cost).toBeCloseTo(0.0264, 5);
  });

  it('returns zero cacheWriteInputTokens when no cache writes present', () => {
    const session = makeSession({
      traces: [{
        id: 'trace-1',
        observations: [{
          id: 'gen-1', name: 'agent-dev', type: 'GENERATION',
          model: 'claude-sonnet-4-6',
          startTime: '2025-01-01T00:00:01Z', endTime: '2025-01-01T00:00:02Z',
          promptTokens: 5000, completionTokens: 100,
          metadata: {
            attributes: {
              'ai.model.id': 'claude-sonnet-4-6',
              'ai.usage.cachedInputTokens': 4000,
            },
          },
        }],
      }],
    });

    const totals = computeSessionTotals([session]);
    expect(totals.cacheWriteInputTokens).toBe(0);
    expect(totals.cachedInputTokens).toBe(4000);
  });
});
