import { describe, expect, it } from 'vitest';

import { mapSegmentsToUI, mapToolCallToUI, mapToolCallsToUI } from '../tool-call-mapper.js';

describe('mapToolCallToUI', () => {
  it('translates persisted "success" status to wire "completed"', () => {
    const ui = mapToolCallToUI({
      id: 'tool-1',
      toolName: 'askQuestion',
      toolArgs: { questions: [{ question: 'pick one', suggestions: [{ text: 'a' }] }] },
      toolResult: { widgetType: 'ask-question', widgetData: { questions: [], currentQuestionIndex: 0, answers: [] } },
      status: 'success',
    });

    expect(ui.status).toBe('completed');
  });

  it('passes "running" through unchanged', () => {
    const ui = mapToolCallToUI({ id: 't', toolName: 'x', status: 'running' });
    expect(ui.status).toBe('running');
  });

  it('passes "error" through unchanged', () => {
    const ui = mapToolCallToUI({ id: 't', toolName: 'x', status: 'error', error: 'boom' });
    expect(ui.status).toBe('error');
    expect(ui.error).toBe('boom');
  });

  it('falls back to "running" when status is undefined', () => {
    const ui = mapToolCallToUI({ id: 't', toolName: 'x' });
    expect(ui.status).toBe('running');
  });

  it('translates status across an array of tool calls', () => {
    const result = mapToolCallsToUI([
      { id: 'a', toolName: 'one', status: 'success' },
      { id: 'b', toolName: 'two', status: 'running' },
      { id: 'c', toolName: 'three', status: 'error' },
    ]);

    expect(result.map((tc) => tc.status)).toEqual(['completed', 'running', 'error']);
  });

  it('preserves result, input, and timing fields alongside the status translation', () => {
    const ui = mapToolCallToUI({
      id: 'tool-2',
      toolName: 'writeFile',
      toolArgs: { path: '/x' },
      toolResult: { ok: true },
      status: 'success',
      startTime: 1000,
      endTime: 1500,
      durationMs: 500,
    });

    expect(ui).toEqual({
      id: 'tool-2',
      name: 'writeFile',
      input: { path: '/x' },
      result: { ok: true },
      status: 'completed',
      error: undefined,
      startTime: 1000,
      endTime: 1500,
      duration: 500,
    });
  });
});

describe('mapSegmentsToUI', () => {
  it('translates "success" → "completed" on the camelCase toolCall key', () => {
    const segments = mapSegmentsToUI([
      {
        id: 'seg-1',
        type: 'tool_call',
        timestamp: '2026-05-27T00:00:00.000Z',
        toolCall: { id: 't', toolName: 'requestSecrets', status: 'success', toolResult: { ok: true } },
      },
    ]);

    expect((segments[0].toolCall as any).status).toBe('completed');
  });

  it('translates status on both the camelCase and snake_case mirrors that normalizeSegments writes', () => {
    const toolCall = { id: 't', toolName: 'askQuestion', status: 'success' as const };
    const segments = mapSegmentsToUI([
      {
        id: 'seg-1',
        type: 'tool_call',
        toolCall: { ...toolCall },
        tool_call: { ...toolCall },
      },
    ]);

    expect((segments[0].toolCall as any).status).toBe('completed');
    expect((segments[0].tool_call as any).status).toBe('completed');
  });

  it('passes "running" and "error" segment statuses through unchanged', () => {
    const segments = mapSegmentsToUI([
      { id: 'a', type: 'tool_call', toolCall: { id: '1', toolName: 'x', status: 'running' } },
      { id: 'b', type: 'tool_call', toolCall: { id: '2', toolName: 'y', status: 'error', error: 'boom' } },
    ]);

    expect((segments[0].toolCall as any).status).toBe('running');
    expect((segments[1].toolCall as any).status).toBe('error');
    expect((segments[1].toolCall as any).error).toBe('boom');
  });

  it('passes content segments through untouched', () => {
    const input = { id: 'seg-c', type: 'content', content: 'hello world', timestamp: '2026-05-27T00:00:00.000Z' };
    const [out] = mapSegmentsToUI([input]);
    expect(out).toBe(input);
  });

  it('passes a tool_call-typed segment with no nested toolCall through untouched', () => {
    const input = { id: 'seg-d', type: 'tool_call', timestamp: '2026-05-27T00:00:00.000Z' };
    const [out] = mapSegmentsToUI([input]);
    expect(out).toBe(input);
  });

  it('preserves the requestSecrets result payload alongside the status translation', () => {
    const result = {
      success: true,
      secretsRequired: true,
      secretsRequest: { secrets: [{ name: 'API_KEY', label: 'API key', required: true }] },
    };
    const segments = mapSegmentsToUI([
      {
        id: 'seg-secrets',
        type: 'tool_call',
        toolCall: {
          id: 'rs-1',
          toolName: 'requestSecrets',
          status: 'success',
          toolResult: result,
        },
      },
    ]);

    expect((segments[0].toolCall as any).status).toBe('completed');
    expect((segments[0].toolCall as any).toolResult).toEqual(result);
  });

  it('preserves segment-level fields (id, type, timestamp, content) untouched', () => {
    const segments = mapSegmentsToUI([
      {
        id: 'seg-1',
        type: 'tool_call',
        content: '',
        timestamp: '2026-05-27T00:00:00.000Z',
        toolCall: { id: 't', toolName: 'x', status: 'success' },
      },
    ]);

    expect(segments[0].id).toBe('seg-1');
    expect(segments[0].type).toBe('tool_call');
    expect(segments[0].content).toBe('');
    expect(segments[0].timestamp).toBe('2026-05-27T00:00:00.000Z');
  });
});
