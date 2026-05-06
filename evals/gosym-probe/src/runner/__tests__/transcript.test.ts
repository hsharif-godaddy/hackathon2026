import { describe, it, expect } from 'vitest';
import { TranscriptBuilder } from '../transcript.js';
import type { Turn, ToolCall } from '../transcript.js';
import type { DOMSnapshot } from '../../clients/dom-capture.js';

const makeTurn = (overrides: Partial<Turn> = {}): Turn => ({
  role: 'user',
  content: 'hello',
  toolCalls: [],
  timestamp: 1000,
  ...overrides,
});

const makeToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: 'tc1',
  name: 'read_file',
  input: { path: '/foo' },
  output: 'contents',
  startTime: 100,
  endTime: 200,
  ...overrides,
});

const makeSnapshot = (html = '<html/>'): DOMSnapshot => ({
  url: 'https://localhost:8443',
  html,
  screenshot: Buffer.from(''),
  timestamp: new Date().toISOString(),
  consoleLogs: [],
});

describe('TranscriptBuilder', () => {
  it('builds empty transcript with correct metadata', () => {
    const transcript = new TranscriptBuilder('my-scenario', 2).build();
    expect(transcript.scenarioName).toBe('my-scenario');
    expect(transcript.trialIndex).toBe(2);
    expect(transcript.turns).toHaveLength(0);
    expect(transcript.snapshots).toHaveLength(0);
    expect(transcript.errors).toHaveLength(0);
  });

  describe('addTurn()', () => {
    it('appends turns in insertion order', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(makeTurn({ content: 'first' }));
      builder.addTurn(makeTurn({ content: 'second', role: 'assistant' }));
      const { turns } = builder.build();
      expect(turns).toHaveLength(2);
      expect(turns[0].content).toBe('first');
      expect(turns[1].content).toBe('second');
    });

    it('preserves turn role', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(makeTurn({ role: 'user' }));
      builder.addTurn(makeTurn({ role: 'assistant' }));
      const { turns } = builder.build();
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
    });

    it('preserves turn timestamp', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(makeTurn({ timestamp: 9999 }));
      const { turns } = builder.build();
      expect(turns[0].timestamp).toBe(9999);
    });
  });

  describe('tool calls', () => {
    it('records id, name, input, and output on a tool call', () => {
      const builder = new TranscriptBuilder('s', 0);
      const tc = makeToolCall({
        id: 'tc-1',
        name: 'write_file',
        input: { path: '/bar', content: 'hi' },
        output: 'ok',
      });
      builder.addTurn(makeTurn({ toolCalls: [tc] }));
      const { turns } = builder.build();
      expect(turns[0].toolCalls[0]).toMatchObject({
        id: 'tc-1',
        name: 'write_file',
        input: { path: '/bar', content: 'hi' },
        output: 'ok',
      });
    });

    it('records tool call error', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(
        makeTurn({ toolCalls: [makeToolCall({ error: 'permission denied' })] }),
      );
      const { turns } = builder.build();
      expect(turns[0].toolCalls[0].error).toBe('permission denied');
    });

    it('records tool call startTime and endTime', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(
        makeTurn({
          toolCalls: [makeToolCall({ startTime: 1000, endTime: 2000 })],
        }),
      );
      const { turns } = builder.build();
      const tc = turns[0].toolCalls[0];
      expect(tc.startTime).toBe(1000);
      expect(tc.endTime).toBe(2000);
    });

    it('supports multiple tool calls per turn', () => {
      const builder = new TranscriptBuilder('s', 0);
      const tc1 = makeToolCall({ id: 'a', name: 'tool_a' });
      const tc2 = makeToolCall({ id: 'b', name: 'tool_b' });
      builder.addTurn(makeTurn({ toolCalls: [tc1, tc2] }));
      const { turns } = builder.build();
      expect(turns[0].toolCalls).toHaveLength(2);
      expect(turns[0].toolCalls.map((t) => t.name)).toEqual([
        'tool_a',
        'tool_b',
      ]);
    });
  });

  describe('addSnapshot()', () => {
    it('attaches snapshots in insertion order', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addSnapshot(makeSnapshot('<html>1</html>'));
      builder.addSnapshot(makeSnapshot('<html>2</html>'));
      const { snapshots } = builder.build();
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].html).toBe('<html>1</html>');
      expect(snapshots[1].html).toBe('<html>2</html>');
    });

    it('preserves snapshot url, html, screenshot, timestamp', () => {
      const builder = new TranscriptBuilder('s', 0);
      const ts = '2026-04-03T00:00:00.000Z';
      const snap: DOMSnapshot = {
        url: 'https://localhost:8443/app',
        html: '<div>app</div>',
        screenshot: Buffer.from([1, 2, 3]),
        timestamp: ts,
        consoleLogs: [],
      };
      builder.addSnapshot(snap);
      expect(builder.build().snapshots[0]).toEqual(snap);
    });
  });

  describe('addError()', () => {
    it('records errors in insertion order', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addError('first error');
      builder.addError('second error');
      expect(builder.build().errors).toEqual(['first error', 'second error']);
    });
  });

  describe('build() immutability', () => {
    it('mutations after build() do not affect the built transcript', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(makeTurn({ content: 'original' }));
      const t = builder.build();
      builder.addTurn(makeTurn({ content: 'added after' }));
      expect(t.turns).toHaveLength(1);
    });

    it('two calls to build() produce independent copies', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addTurn(makeTurn());
      const t1 = builder.build();
      builder.addTurn(makeTurn());
      const t2 = builder.build();
      expect(t1.turns).toHaveLength(1);
      expect(t2.turns).toHaveLength(2);
    });
  });
});
