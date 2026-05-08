import { describe, it, expect } from 'vitest';
import type { DOMSnapshot } from '../../clients/dom-capture.js';
import type { CapturedSite } from '../../clients/site-capture/types.js';
import { TranscriptBuilder } from '../transcript.js';
import type { Turn, ToolCall } from '../transcript.js';

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

const makeSnapshot = (
  htmlPath = '/tmp/snap/0.html',
): DOMSnapshot => ({
  url: 'https://localhost:8443',
  htmlPath,
  screenshotPath: '/tmp/snap/0.png',
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
      builder.addSnapshot(makeSnapshot('/tmp/snap-a/0.html'));
      builder.addSnapshot(makeSnapshot('/tmp/snap-b/0.html'));
      const { snapshots } = builder.build();
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].htmlPath).toBe('/tmp/snap-a/0.html');
      expect(snapshots[1].htmlPath).toBe('/tmp/snap-b/0.html');
    });

    it('preserves snapshot url, paths, timestamp, consoleLogs', () => {
      const builder = new TranscriptBuilder('s', 0);
      const ts = '2026-04-03T00:00:00.000Z';
      const snap: DOMSnapshot = {
        url: 'https://localhost:8443/app',
        htmlPath: '/tmp/snap/0.html',
        screenshotPath: '/tmp/snap/0.png',
        timestamp: ts,
        consoleLogs: [{ type: 'log', text: 'hi' }],
      };
      builder.addSnapshot(snap);
      expect(builder.build().snapshots[0]).toEqual(snap);
    });
  });

  describe('addCapturedSite()', () => {
    const sample: CapturedSite = {
      previewUrl: 'https://example.com',
      generatedAt: '2026-04-29T00:00:00.000Z',
      durationMs: 1234,
      outputDir: '/tmp/out',
      routes: [
        {
          path: '/',
          url: 'https://example.com',
          origin: 'homepage',
          status: 'ok',
          httpStatus: 200,
        },
      ],
      perRoute: [],
      errors: [],
    };

    it('is omitted from the built transcript when never attached', () => {
      const transcript = new TranscriptBuilder('s', 0).build();
      expect(transcript.capturedSite).toBeUndefined();
    });

    it('attaches the captured site to the built transcript', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addCapturedSite(sample);
      expect(builder.build().capturedSite).toEqual(sample);
    });

    it('keeps only the most recent captured site when called twice', () => {
      const builder = new TranscriptBuilder('s', 0);
      builder.addCapturedSite(sample);
      const replacement: CapturedSite = {
        ...sample,
        previewUrl: 'https://other.example.com',
      };
      builder.addCapturedSite(replacement);
      expect(builder.build().capturedSite?.previewUrl).toBe(
        'https://other.example.com',
      );
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
