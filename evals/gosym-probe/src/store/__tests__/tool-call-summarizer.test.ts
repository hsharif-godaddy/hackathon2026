import { describe, it, expect } from 'vitest';
import type { Turn } from '../../runner/transcript.js';
import { summarizeToolCalls } from '../tool-call-summarizer.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTurn(
  toolCalls: Turn['toolCalls'] = [],
  role: Turn['role'] = 'assistant',
): Turn {
  return {
    role,
    content: '',
    toolCalls,
    timestamp: Date.now(),
  };
}

function makeToolCall(
  name: string,
  overrides: Partial<Turn['toolCalls'][number]> = {},
): Turn['toolCalls'][number] {
  return {
    id: `tc-${name}`,
    name,
    startTime: 1000,
    endTime: 1100,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('summarizeToolCalls()', () => {
  it('returns empty summary for empty turns array', () => {
    const result = summarizeToolCalls([]);

    expect(result.sequence).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.uniqueTools).toEqual([]);
    expect(result.uniqueCount).toBe(0);
    expect(result.countByTool).toEqual({});
  });

  it('returns empty summary for user-only turns with no tool calls', () => {
    const turns = [
      makeTurn([], 'user'),
      makeTurn([], 'user'),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.sequence).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('handles assistant turns with empty toolCalls', () => {
    const turns = [makeTurn([], 'assistant')];

    const result = summarizeToolCalls(turns);

    expect(result.sequence).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('extracts a single tool call correctly', () => {
    const tc = makeToolCall('readFile', {
      startTime: 1000,
      endTime: 1200,
    });
    const turns = [makeTurn([tc])];

    const result = summarizeToolCalls(turns);

    expect(result.sequence).toHaveLength(1);
    expect(result.sequence[0]).toEqual({
      index: 0,
      turnIndex: 0,
      name: 'readFile',
      hasError: false,
      startTime: 1000,
      endTime: 1200,
    });
    expect(result.totalCount).toBe(1);
    expect(result.uniqueTools).toEqual(['readFile']);
    expect(result.uniqueCount).toBe(1);
    expect(result.countByTool).toEqual({ readFile: 1 });
  });

  it('sequences tool calls across multiple turns in order', () => {
    const turns = [
      makeTurn([makeToolCall('readFile')]),
      makeTurn([], 'user'),
      makeTurn([
        makeToolCall('writeFile'),
        makeToolCall('readFile'),
      ]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.sequence).toHaveLength(3);
    expect(result.sequence[0].index).toBe(0);
    expect(result.sequence[0].turnIndex).toBe(0);
    expect(result.sequence[0].name).toBe('readFile');
    expect(result.sequence[1].index).toBe(1);
    expect(result.sequence[1].turnIndex).toBe(2);
    expect(result.sequence[1].name).toBe('writeFile');
    expect(result.sequence[2].index).toBe(2);
    expect(result.sequence[2].turnIndex).toBe(2);
    expect(result.sequence[2].name).toBe('readFile');
  });

  it('aggregates repeated tool call counts', () => {
    const turns = [
      makeTurn([makeToolCall('readFile'), makeToolCall('readFile')]),
      makeTurn([makeToolCall('writeFile')]),
      makeTurn([makeToolCall('readFile')]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.totalCount).toBe(4);
    expect(result.countByTool).toEqual({ readFile: 3, writeFile: 1 });
  });

  it('deduplicates uniqueTools and sorts alphabetically', () => {
    const turns = [
      makeTurn([
        makeToolCall('writeFile'),
        makeToolCall('readFile'),
        makeToolCall('media'),
        makeToolCall('writeFile'),
      ]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.uniqueTools).toEqual([
      'media',
      'readFile',
      'writeFile',
    ]);
    expect(result.uniqueCount).toBe(3);
  });

  it('sets hasError true when tool call has an error string', () => {
    const tc = makeToolCall('readFile', { error: 'file not found' });
    const turns = [makeTurn([tc])];

    const result = summarizeToolCalls(turns);

    expect(result.sequence[0].hasError).toBe(true);
  });

  it('sets hasError false when tool call has no error', () => {
    const tc = makeToolCall('readFile');
    const turns = [makeTurn([tc])];

    const result = summarizeToolCalls(turns);

    expect(result.sequence[0].hasError).toBe(false);
  });

  it('propagates agentId when present', () => {
    const tc = makeToolCall('readFile', { agentId: 'developer-agent' });
    const turns = [makeTurn([tc])];

    const result = summarizeToolCalls(turns);

    expect(result.sequence[0].agentId).toBe('developer-agent');
  });

  it('omits agentId when not present on tool call', () => {
    const tc = makeToolCall('readFile');
    const turns = [makeTurn([tc])];

    const result = summarizeToolCalls(turns);

    expect(result.sequence[0]).not.toHaveProperty('agentId');
  });

  it('handles mixed turns with and without tool calls', () => {
    const turns = [
      makeTurn([], 'user'),
      makeTurn([makeToolCall('readFile')]),
      makeTurn([], 'user'),
      makeTurn([makeToolCall('writeFile')]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.totalCount).toBe(2);
    expect(result.sequence[0].turnIndex).toBe(1);
    expect(result.sequence[1].turnIndex).toBe(3);
  });

  // ── failedCount ──────────────────────────────────────────────────────────────

  it('failedCount is 0 for empty turns', () => {
    const result = summarizeToolCalls([]);

    expect(result.failedCount).toBe(0);
  });

  it('failedCount is 0 when no tool calls have errors', () => {
    const turns = [
      makeTurn([makeToolCall('readFile'), makeToolCall('writeFile')]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.failedCount).toBe(0);
  });

  it('failedCount counts tool calls with errors', () => {
    const turns = [
      makeTurn([
        makeToolCall('readFile', { error: 'file not found' }),
        makeToolCall('writeFile'),
        makeToolCall('deleteFile', { error: 'permission denied' }),
      ]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.failedCount).toBe(2);
  });

  it('failedCount aggregates errors across multiple turns', () => {
    const turns = [
      makeTurn([
        makeToolCall('readFile', { error: 'not found' }),
        makeToolCall('writeFile'),
      ]),
      makeTurn([], 'user'),
      makeTurn([
        makeToolCall('deleteFile', { error: 'denied' }),
        makeToolCall('readFile'),
      ]),
    ];

    const result = summarizeToolCalls(turns);

    expect(result.failedCount).toBe(2);
  });
});
