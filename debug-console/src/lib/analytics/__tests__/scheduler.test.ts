import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock es-db / es-client before importing scheduler so scheduler's imports
// don't touch real Elasticsearch and we can inspect recorded inserts.
const recordedInserts: Array<{ event: string; es_id: string; app_id: string; logLine: string }> = [];
const recordedErrors: Array<{ es_id: string; app_id: string; event_type: string; error_message?: string }> = [];

vi.mock('../es-db', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  insertRun: vi.fn((doc: { es_id: string; app_id: string }) => {
    recordedInserts.push({ event: 'run', es_id: doc.es_id, app_id: doc.app_id, logLine: '' });
  }),
  insertCompression: vi.fn((doc: { es_id: string; app_id: string }) => {
    recordedInserts.push({ event: 'compression', es_id: doc.es_id, app_id: doc.app_id, logLine: '' });
  }),
  insertError: vi.fn((doc: { es_id: string; app_id: string; event_type: string; error_message?: string }) => {
    recordedErrors.push({
      es_id: doc.es_id,
      app_id: doc.app_id,
      event_type: doc.event_type,
      error_message: doc.error_message,
    });
  }),
  insertConversation: vi.fn((doc: { es_id: string; app_id: string; event_type: string }) => {
    recordedInserts.push({ event: `conv:${doc.event_type}`, es_id: doc.es_id, app_id: doc.app_id, logLine: '' });
  }),
  insertSummarization: vi.fn(),
  insertToolFailure: vi.fn(),
  insertPublishEvent: vi.fn((doc: { es_id: string; app_id: string; event_type: string }) => {
    recordedInserts.push({ event: `publish:${doc.event_type}`, es_id: doc.es_id, app_id: doc.app_id, logLine: '' });
  }),
  insertClientError: vi.fn((doc: { es_id: string; app_id: string; event_type: string }) => {
    recordedInserts.push({ event: `client:${doc.event_type}`, es_id: doc.es_id, app_id: doc.app_id, logLine: '' });
  }),
  flushPendingDocs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../es-client', () => ({
  INDICES: { CLIENT_ERRORS: 'client_errors' },
  writeClient: { search: vi.fn(), scroll: vi.fn(), clearScroll: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { logger } from '@/lib/logger';

import * as esClient from '../es-client';
import * as esDb from '../es-db';
import {
  defaultAgentsStreamSelector,
  escapeRegex,
  fetchAndProcessKatanaErrors,
  fetchAndProcessPioneerEvents,
  hashLine,
  iterLokiEventLines,
  runBackfill,
  runFetch
} from '../scheduler';

const mockedLoggerWarn = logger.warn as unknown as ReturnType<typeof vi.fn>;
const mockedLoggerError = logger.error as unknown as ReturnType<typeof vi.fn>;

const originalEnv = process.env;
const originalFetch = global.fetch;

function mockFetchSequence(responses: Array<{ result: Array<{ stream: Record<string, string>; values: Array<[string, string]> }> }>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: response }),
      text: async () => '',
    } as unknown as Response);
  }
  return fetchMock;
}

describe('scheduler', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LOKI_ENDPOINT = 'https://loki.test';
    process.env.LOKI_API_KEY = 'test-key';
    process.env.ENVIRONMENT_NAME = 'dev';
    recordedInserts.length = 0;
    recordedErrors.length = 0;
    mockedLoggerWarn.mockReset();
    mockedLoggerError.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('escapeRegex', () => {
    it('escapes RE2 metacharacters used in event names', () => {
      expect(escapeRegex('agent.run.finish')).toBe('agent\\.run\\.finish');
      expect(escapeRegex('route.publish.strategy-selected')).toBe('route\\.publish\\.strategy-selected');
    });

    it('escapes regex grouping and alternation characters', () => {
      expect(escapeRegex('a|b')).toBe('a\\|b');
      expect(escapeRegex('(x)')).toBe('\\(x\\)');
      expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
    });

    it('escapes brackets and backslashes', () => {
      expect(escapeRegex('[x]')).toBe('\\[x\\]');
      expect(escapeRegex('{y}')).toBe('\\{y\\}');
      expect(escapeRegex('back\\slash')).toBe('back\\\\slash');
    });

    it('escapes double-quotes so the result is safe inside LogQL\'s |~ "..." filter', () => {
      // Without escaping, the surrounding `|~ "..."` LogQL string would be
      // closed early by the embedded `"` and produce a malformed query.
      expect(escapeRegex('weird"event')).toBe('weird\\"event');
    });

    it('leaves non-metacharacters untouched', () => {
      expect(escapeRegex('plain-event_name')).toBe('plain-event_name');
    });
  });

  describe('hashLine', () => {
    it('returns a stable 16-char hex hash for a given line', () => {
      const hashed = hashLine('{"event":"agent.run.finish","app_id":"abc"}');
      expect(hashed).toMatch(/^[0-9a-f]{16}$/);
      expect(hashLine('{"event":"agent.run.finish","app_id":"abc"}')).toBe(hashed);
    });

    it('produces different hashes for different lines', () => {
      expect(hashLine('{"a":1}')).not.toBe(hashLine('{"a":2}'));
    });
  });

  describe('iterLokiEventLines', () => {
    const start = new Date('2026-04-22T00:00:00Z');
    const end = new Date('2026-04-22T01:00:00Z');

    it('yields a single page when the response is below the limit', async () => {
      global.fetch = mockFetchSequence([
        {
          result: [
            { stream: { job: 'airo-agents' }, values: [
              ['1000000000000000000', '{"event":"e1"}'],
              ['1000000000000000001', '{"event":"e2"}'],
            ] },
          ],
        },
      ]) as unknown as typeof fetch;

      const pages: Array<Array<[string, string]>> = [];
      for await (const page of iterLokiEventLines(start, end, 'e1|e2')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0]).toHaveLength(2);
      expect(pages[0][0][1]).toBe('{"event":"e1"}');
    });

    it('paginates via time cursor when a page hits the 5000 limit', async () => {
      // Use timestamps inside the [start, end] window so the generator's
      // `lastNs < cursorNs` guard doesn't trip.
      const baseNs = BigInt(start.getTime()) * 1_000_000n;
      const page1Values: Array<[string, string]> = [];
      for (let i = 1; i <= 5000; i++) {
        page1Values.push([String(baseNs + BigInt(i)), `line-${i}`]);
      }
      const lastPage1Ns = baseNs + 5000n;
      const page2Values: Array<[string, string]> = [
        [String(baseNs + 5001n), 'line-5001'],
      ];

      const fetchMock = mockFetchSequence([
        { result: [{ stream: {}, values: page1Values }] },
        { result: [{ stream: {}, values: page2Values }] },
      ]);
      global.fetch = fetchMock as unknown as typeof fetch;

      const pages: Array<Array<[string, string]>> = [];
      for await (const page of iterLokiEventLines(start, end, 'x')) {
        pages.push(page);
      }

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(5000);
      expect(pages[1]).toHaveLength(1);

      // Second request's `start` cursor must equal the last ns of page 1 so
      // we can catch tied-timestamp entries split across page boundaries.
      const secondCallUrl = String(fetchMock.mock.calls[1][0]);
      expect(secondCallUrl).toContain(`start=${String(lastPage1Ns)}`);
    });

    it('dedupes tied-nanosecond entries that appear on the boundary between pages', async () => {
      const baseNs = BigInt(start.getTime()) * 1_000_000n;
      const tiedNs = String(baseNs + 5000n);

      // Page 1 ends with 5000 entries, the last two share `tiedNs`.
      const page1Values: Array<[string, string]> = [];
      for (let i = 1; i <= 4998; i++) {
        page1Values.push([String(baseNs + BigInt(i)), `line-${i}`]);
      }
      page1Values.push([tiedNs, 'tied-A']);
      page1Values.push([tiedNs, 'tied-B']);

      // Page 2 re-emits tied-A and tied-B (Loki re-includes entries at `start`)
      // plus a new tied-C that was trimmed from page 1. Keep page size under
      // 5000 so pagination stops.
      const page2Values: Array<[string, string]> = [
        [tiedNs, 'tied-A'],
        [tiedNs, 'tied-B'],
        [tiedNs, 'tied-C'],
      ];

      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: page1Values }] },
        { result: [{ stream: {}, values: page2Values }] },
      ]) as unknown as typeof fetch;

      const emittedLines: string[] = [];
      for await (const page of iterLokiEventLines(start, end, 'x')) {
        for (const [, line] of page) emittedLines.push(line);
      }

      // Each tied line should appear exactly once.
      expect(emittedLines.filter(l => l === 'tied-A')).toHaveLength(1);
      expect(emittedLines.filter(l => l === 'tied-B')).toHaveLength(1);
      expect(emittedLines.filter(l => l === 'tied-C')).toHaveLength(1);
    });

    it('stops when a full page is stuck at a single nanosecond (avoids infinite loop)', async () => {
      const baseNs = BigInt(start.getTime()) * 1_000_000n;
      const stuckNs = String(baseNs + 1n);
      // A full page (5000 entries) all sharing one ns. Cursor advances once
      // (to stuckNs) and then must bail rather than re-querying at stuckNs
      // forever when the next page is still stuck there.
      const stuckValues: Array<[string, string]> = [];
      for (let i = 0; i < 5000; i++) {
        stuckValues.push([stuckNs, `line-${i}`]);
      }

      const fetchMock = mockFetchSequence([
        { result: [{ stream: {}, values: stuckValues }] },
        { result: [{ stream: {}, values: stuckValues }] },
      ]);
      global.fetch = fetchMock as unknown as typeof fetch;

      const pages: Array<Array<[string, string]>> = [];
      for await (const page of iterLokiEventLines(start, end, 'x')) {
        pages.push(page);
      }

      // Two fetches: first advances cursor, second detects lastNs === cursorNs
      // and breaks. No third fetch should happen.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toHaveLength(5000);
    });

    it('stops on an empty page', async () => {
      global.fetch = mockFetchSequence([
        { result: [] },
      ]) as unknown as typeof fetch;

      const pages: Array<Array<[string, string]>> = [];
      for await (const page of iterLokiEventLines(start, end, 'x')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(0);
    });

    it('throws when Loki returns a non-2xx status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      } as unknown as Response) as unknown as typeof fetch;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          void _;
        }
      };

      await expect(consume()).rejects.toThrow(/Loki query_range failed: HTTP 500/);
    });

    it('throws when LOKI_ENDPOINT is missing', async () => {
      delete process.env.LOKI_ENDPOINT;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          void _;
        }
      };

      await expect(consume()).rejects.toThrow(/LOKI_ENDPOINT is required/);
    });

    it('throws a descriptive error when Loki returns a 200 with non-JSON body (HTML proxy error page)', async () => {
      // Simulate a Grafana proxy 200 with HTML body — res.json() throws SyntaxError.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
        text: async () => '<html>...</html>',
      } as unknown as Response) as unknown as typeof fetch;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          void _;
        }
      };

      await expect(consume()).rejects.toThrow(/non-JSON 200 response/);
    });

    it('throws a descriptive error when Loki returns an unexpected response shape', async () => {
      // status:success but data.result is missing/null/non-array.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', data: { result: null } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          void _;
        }
      };

      await expect(consume()).rejects.toThrow(/unexpected response shape/);
    });

    it('throws when Loki returns HTTP 200 with status=error (server-side query failure)', async () => {
      // Loki returns 200 + status:error on query timeouts, malformed LogQL,
      // and label-selector mismatches. Without this guard, data.result is
      // an empty array, the cursor advances past the chunk, and the data
      // is silently lost on the next forward-incremental run.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'error',
          errorType: 'execution',
          error: 'context deadline exceeded',
          data: { result: [] },
        }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          void _;
        }
      };

      await expect(consume()).rejects.toThrow(/status=error: execution - context deadline exceeded/);
    });

    it('logs at error severity and bails on the stuck-ns guard so the data loss pages on-call', async () => {
      const baseNs = BigInt(start.getTime()) * 1_000_000n;
      const stuckNs = String(baseNs + 1n);
      // A full page (5000 entries) all sharing one ns. Cursor advances once
      // (to stuckNs), the next fetch returns the same stuck page so
      // lastNs === cursorNs and we bail.
      const stuckValues: Array<[string, string]> = [];
      for (let i = 0; i < 5000; i++) {
        stuckValues.push([stuckNs, `line-${i}`]);
      }

      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: stuckValues }] },
        { result: [{ stream: {}, values: stuckValues }] },
      ]) as unknown as typeof fetch;

      const pages: Array<Array<[string, string]>> = [];
      for await (const page of iterLokiEventLines(start, end, 'x')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      // logger.error is required (not warn) because the trimmed entries are
      // permanently lost on the next forward-incremental run; alerting must
      // fire instead of getting buried in warn-level noise.
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.loki.stuckNanosecond',
        expect.objectContaining({
          stuckNs,
          emittedAtStuckNs: 5000,
          message: expect.stringMatching(/LOST/),
        }),
      );
    });

    it('throws a descriptive timeout error when AbortSignal fires (TimeoutError)', async () => {
      // The try/catch around fetch() must distinguish AbortSignal.timeout()
      // rejection (DOMException name=TimeoutError) from generic network
      // failures. If this branch were inverted, a TypeError would surface as
      // "timed out after 60s" and mislead operators into investigating Loki
      // latency instead of DNS/connectivity.
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      global.fetch = vi.fn().mockRejectedValue(timeoutErr) as unknown as typeof fetch;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          // unreachable
        }
      };

      await expect(consume()).rejects.toThrow(/timed out after 60s/);
    });

    it('throws a descriptive network error when fetch rejects with a generic error', async () => {
      // The non-timeout branch of the try/catch. ECONNREFUSED / ENOTFOUND /
      // TypeError("Failed to fetch") all land here; the message must NOT
      // contain "timed out" or operators will look in the wrong place.
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

      const consume = async () => {
        for await (const _ of iterLokiEventLines(start, end, 'x')) {
          // unreachable
        }
      };

      await expect(consume()).rejects.toThrow(/Loki query_range network error/);
    });
  });

  describe('fetchAndProcessPioneerEvents', () => {
    const start = new Date('2026-04-22T00:00:00Z');
    const end = new Date('2026-04-22T01:00:00Z');

    function makeRunLogLine(appId: string, tag: string): string {
      return JSON.stringify({
        event: 'agent.run.finish',
        app_id: appId,
        agentId: 'agent-1',
        data: {
          agentName: 'test-agent',
          finishReason: 'stop',
          steps: 1,
          totalUsage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
          tag,
        },
      });
    }

    it('counts only configured events, skipping lines whose event is filtered out', async () => {
      const lines: Array<[string, string]> = [
        ['1000000000000000001', makeRunLogLine('app-1', 'a')],
        ['1000000000000000002', JSON.stringify({ event: 'some.other.event', app_id: 'app-1' })],
        ['1000000000000000003', makeRunLogLine('app-2', 'b')],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({ 'agent.run.finish': 2 });
    });

    it('skips non-JSON lines and entries missing app_id', async () => {
      const lines: Array<[string, string]> = [
        ['1000000000000000001', 'not-json'],
        ['1000000000000000002', JSON.stringify({ event: 'agent.run.finish' })],
        ['1000000000000000003', makeRunLogLine('app-1', 'a')],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({ 'agent.run.finish': 1 });
    });

    it('returns immediately when the events list is empty (no fetch)', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, [], { value: 0 });

      expect(counts).toEqual({});
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('produces stable es_id values for the same log line across runs', async () => {
      const line = makeRunLogLine('app-1', 'stable');
      const values: Array<[string, string]> = [['1000000000000000001', line]];

      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values }] },
        { result: [{ stream: {}, values }] },
      ]) as unknown as typeof fetch;

      await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });
      const firstRun = recordedInserts.map(i => i.es_id);
      recordedInserts.length = 0;

      await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });
      const secondRun = recordedInserts.map(i => i.es_id);

      expect(firstRun).toEqual(secondRun);
      expect(firstRun[0]).toBe(`loki-1000000000000000001-${hashLine(line)}`);
    });

    it('escalates to logger.error when 100% of matched lines fail JSON.parse', async () => {
      // Every line matches the regex (contains `"event":"agent.run.finish"`)
      // but is malformed JSON, so parsedMatchedLines stays at 0 and the
      // jsonParseFailures branch should fire at error severity, not warn.
      const lines: Array<[string, string]> = [
        ['1000000000000000001', '{"event":"agent.run.finish",broken'],
        ['1000000000000000002', '{"event":"agent.run.finish",also-broken'],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({});
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.loki.jsonParseFailures',
        expect.objectContaining({
          jsonParseFailures: 2,
          parsedMatchedLines: 0,
        }),
      );
      // Same event must NOT also fire at warn - that would mean we're
      // double-logging.
      const dupAtWarn = mockedLoggerWarn.mock.calls.find(
        (call) => call[0] === 'scheduler.loki.jsonParseFailures',
      );
      expect(dupAtWarn).toBeUndefined();
    });

    it('warns when matched event lines all get dropped (e.g. missing app_id)', async () => {
      // Every entry matches the regex and parses as JSON, but all are missing
      // app_id so processPioneerLog returns false for each. The scheduler
      // should warn so the operator can investigate the schema regression.
      const line = JSON.stringify({ event: 'agent.run.finish', data: {} });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', line],
        ['1000000000000000002', line],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({});
      expect(mockedLoggerWarn).toHaveBeenCalledWith(
        'scheduler.events.allDropped',
        expect.objectContaining({
          parsedMatchedLines: 2,
          processedLines: 0,
        }),
      );
    });

    it('flushes and resets pendingCount when threshold is reached', async () => {
      // Pre-fill pendingCount to one below the 1000 threshold so a single
      // processable line tips it over and triggers exactly one flush.
      const pendingCount = { value: 999 };
      const lines: Array<[string, string]> = [
        ['1000000000000000001', makeRunLogLine('app-1', 'a')],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;
      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();

      await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], pendingCount);

      expect(flushMock).toHaveBeenCalledTimes(1);
      // Counter must reset so the next chunk doesn't immediately re-flush
      // on its first processable line.
      expect(pendingCount.value).toBe(0);
    });

    it('resets pendingCount and logs chunk context when flushPendingDocs throws', async () => {
      // If the reset moved out of `finally` to `try`, every subsequent line
      // would re-trigger a doomed flush. Lock that down here. Also verifies
      // the mid-loop flush rethrow includes the chunk window + pendingDocs
      // count so the top-level "Fetch failed" doesn't bury which chunk lost.
      const pendingCount = { value: 999 };
      const lines: Array<[string, string]> = [
        ['1000000000000000001', makeRunLogLine('app-1', 'a')],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;
      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();
      flushMock.mockRejectedValueOnce(new Error('bulk index failed'));

      await expect(
        fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], pendingCount),
      ).rejects.toThrow('bulk index failed');

      expect(flushMock).toHaveBeenCalledTimes(1);
      expect(pendingCount.value).toBe(0);
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.events.midLoopFlushFailed',
        expect.objectContaining({
          pendingDocs: 1000,
          windowStart: start.toISOString(),
          windowEnd: end.toISOString(),
          event: 'agent.run.finish',
        }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it('counts each event independently when a page interleaves multiple event types', async () => {
      // Guards against a switch-dispatch bug that collapsed counts into one
      // key. Both insertRun and insertCompression must fire with their own
      // counts; perEventCounts must reflect the split.
      const runLine = makeRunLogLine('app-1', 'r');
      const compLine = JSON.stringify({
        event: 'compression.batch.complete',
        app_id: 'app-1',
        data: {
          totalMessages: 10,
          compressedMessages: 5,
          originalTotalLength: 1000,
          compressedTotalLength: 400,
          compressionRatio: 0.4,
          savedBytes: 600,
        },
      });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', runLine],
        ['1000000000000000002', compLine],
        ['1000000000000000003', runLine],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(
        start,
        end,
        ['agent.run.finish', 'compression.batch.complete'],
        { value: 0 },
      );

      expect(counts).toEqual({
        'agent.run.finish': 2,
        'compression.batch.complete': 1,
      });
      expect(esDb.insertRun).toHaveBeenCalledTimes(2);
      expect(esDb.insertCompression).toHaveBeenCalledTimes(1);
    });

    it('drops agent.run.finish entries with zero tokens (cached/cancelled run)', async () => {
      // Cached or cancelled runs report `totalUsage` with 0/0 tokens. These
      // shouldn't pollute spend dashboards. processPioneerLog has an explicit
      // guard for the `agent.run.finish` case that returns false when
      // input+output tokens are both 0; without this test, removing the
      // guard silently inflates run counts.
      const zeroTokenLine = JSON.stringify({
        event: 'agent.run.finish',
        app_id: 'app-1',
        agentId: 'agent-1',
        data: {
          agentName: 'cached',
          finishReason: 'stop',
          totalUsage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        },
      });
      const noUsageLine = JSON.stringify({
        event: 'agent.run.finish',
        app_id: 'app-2',
        agentId: 'agent-2',
        data: { agentName: 'cancelled', finishReason: 'stop' },
      });
      const realLine = makeRunLogLine('app-3', 'real');
      const lines: Array<[string, string]> = [
        ['1000000000000000001', zeroTokenLine],
        ['1000000000000000002', noUsageLine],
        ['1000000000000000003', realLine],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({ 'agent.run.finish': 1 });
      expect(esDb.insertRun).toHaveBeenCalledTimes(1);
      expect(recordedInserts.map((i) => i.app_id)).toEqual(['app-3']);
    });

    it('discriminates websocket.conversation.error into budget vs non-budget event types', async () => {
      // The budget branch is the only case in processPioneerLog that emits
      // both an insertConversation AND an insertError for one log line, with
      // event_type=budget_exceeded vs conversation_error / websocket.conversation.error.
      // A regression that mislabels budget errors as generic errors is silent.
      const budgetLine = JSON.stringify({
        event: 'websocket.conversation.error',
        app_id: 'app-1',
        agentId: 'agent-1',
        data: { error: 'Monthly budget exceeded for tenant', socketId: 'sock-1' },
      });
      const otherLine = JSON.stringify({
        event: 'websocket.conversation.error',
        app_id: 'app-2',
        agentId: 'agent-2',
        data: { error: 'connection reset by peer', socketId: 'sock-2' },
      });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', budgetLine],
        ['1000000000000000002', otherLine],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      await fetchAndProcessPioneerEvents(start, end, ['websocket.conversation.error'], { value: 0 });

      const convoTypes = recordedInserts
        .filter((i) => i.event.startsWith('conv:'))
        .map((i) => ({ app_id: i.app_id, event_type: i.event.replace('conv:', '') }));
      expect(convoTypes).toEqual([
        { app_id: 'app-1', event_type: 'budget_exceeded' },
        { app_id: 'app-2', event_type: 'conversation_error' },
      ]);

      const errorTypes = recordedErrors.map((e) => ({ app_id: e.app_id, event_type: e.event_type }));
      expect(errorTypes).toEqual([
        { app_id: 'app-1', event_type: 'budget_exceeded' },
        { app_id: 'app-2', event_type: 'websocket.conversation.error' },
      ]);
      // Budget error must keep the original error message body so analytics
      // can group by reason; the suffix on _id keeps the conversation +
      // error docs distinct in the same _id namespace.
      expect(recordedErrors[0].error_message).toBe('Monthly budget exceeded for tenant');
      expect(recordedErrors[0].es_id).toBe(recordedInserts[0].es_id + '_err');
    });
  });

  describe('defaultAgentsStreamSelector', () => {
    it('selects the prod label when ENVIRONMENT_NAME=prod', () => {
      process.env.ENVIRONMENT_NAME = 'prod';
      expect(defaultAgentsStreamSelector()).toBe('{job="airo-agents", env="prod"}');
    });

    it('selects the dev label when ENVIRONMENT_NAME=dev', () => {
      // Regression guard: a flipped or stripped ternary that always returned
      // dev would silently fetch zero production events and report empty
      // dashboards instead of a hard failure.
      process.env.ENVIRONMENT_NAME = 'dev';
      expect(defaultAgentsStreamSelector()).toBe('{job="airo-agents", env="dev"}');
    });

    it('defaults to dev when ENVIRONMENT_NAME is unset', () => {
      delete process.env.ENVIRONMENT_NAME;
      expect(defaultAgentsStreamSelector()).toBe('{job="airo-agents", env="dev"}');
    });
  });

  describe('runBackfill', () => {
    it('rejects 0 days with a descriptive error', async () => {
      // Lower bound of the `days < 1 || days > 30` guard. 0 is a common
      // off-by-one from API callers and would otherwise pass through to a
      // zero-window backfill that touches every index for nothing.
      await expect(runBackfill(0)).rejects.toThrow(/Invalid backfill days/);
    });

    it('rejects 31 days because ES retention caps at 30', async () => {
      await expect(runBackfill(31)).rejects.toThrow(/Invalid backfill days/);
    });

    it('accepts the inclusive boundaries (1 and 30)', async () => {
      // No fetch responses queued means iterLokiEventLines short-circuits on
      // the first network call; the test only needs to assert that the
      // validation didn't throw.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;
      // Empty CLIENT_ERRORS aggregation so the writeClient.search mock
      // doesn't need a maxTs.
      vi.mocked(esDb.flushPendingDocs).mockClear();

      await expect(runBackfill(1, 'agent_runs')).resolves.toMatchObject({ pioneerCounts: {} });
      await expect(runBackfill(30, 'agent_runs')).resolves.toMatchObject({ pioneerCounts: {} });
    });

    it('with indexFilter=client_errors only scans Katana (no Loki fetch)', async () => {
      // Confirms the eventMapping branch in runBackfill: client_errors maps to
      // 'katana', so iterLokiEventLines must not be invoked. Without this
      // pin, refactoring INDEX_TO_EVENTS could silently re-introduce a Loki
      // scan for a Katana-only filter and double the runtime cost.
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: {
          hits: [
            {
              _id: 'k1',
              _source: {
                '@timestamp': '2026-04-22T00:00:00Z',
                event: 'client.websocket.connection.error',
                level: 'error',
                data: { appId: 'app-1', error: 'timeout' },
              },
            },
          ],
        },
      } as never);
      vi.mocked(esClient.writeClient.scroll).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);

      const result = await runBackfill(1, 'client_errors');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.pioneerCounts).toEqual({});
      expect(result.katanaCount).toBe(1);
      expect(recordedInserts).toEqual([
        expect.objectContaining({
          event: 'client:client.websocket.connection.error',
          app_id: 'app-1',
        }),
      ]);
    });

    it('with indexFilter=all scans both Pioneer (Loki) and Katana (ES scroll)', async () => {
      // shouldProcessPioneer && shouldProcessKatana are both true only for
      // 'all'. A regression that flips either flag for this branch would
      // silently skip an entire ingestion path with no test failure.
      const pioneerLine = JSON.stringify({
        event: 'agent.run.finish',
        app_id: 'pioneer-app',
        agentId: 'agent-1',
        data: {
          agentName: 'a',
          finishReason: 'stop',
          steps: 1,
          totalUsage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
        },
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { result: [{ stream: {}, values: [['1000000000000000001', pioneerLine]] }] },
        }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: {
          hits: [{
            _id: 'k1',
            _source: {
              '@timestamp': '2026-04-22T00:00:00Z',
              event: 'client.websocket.connection.error',
              level: 'error',
              data: { appId: 'katana-app', error: 'timeout' },
            },
          }],
        },
      } as never);
      vi.mocked(esClient.writeClient.scroll).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);

      const result = await runBackfill(1, 'all');

      expect(global.fetch).toHaveBeenCalled();
      expect(result.pioneerCounts['agent.run.finish']).toBeGreaterThanOrEqual(1);
      expect(result.katanaCount).toBe(1);
      const appIds = recordedInserts.map((i) => i.app_id);
      expect(appIds).toContain('pioneer-app');
      expect(appIds).toContain('katana-app');
    });

    it('logs scheduler.runBackfill.finalFlushFailed and rethrows when the closing flush rejects', async () => {
      // The mid-loop flush threshold isn't crossed (single hit << 1000),
      // so pendingCount is non-zero only at the final flush. If the
      // logger.error before rethrow were removed, the closing batch loss
      // would surface only as a generic "Backfill failed" with no batch
      // size or window context. Pin the contract.
      const pioneerLine = JSON.stringify({
        event: 'agent.run.finish',
        app_id: 'app-1',
        agentId: 'agent-1',
        data: {
          agentName: 'a',
          finishReason: 'stop',
          steps: 1,
          totalUsage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
        },
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { result: [{ stream: {}, values: [['1000000000000000001', pioneerLine]] }] },
        }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;
      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();
      flushMock.mockRejectedValueOnce(new Error('final flush boom'));

      await expect(runBackfill(1, 'agent_runs')).rejects.toThrow('final flush boom');
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.runBackfill.finalFlushFailed',
        expect.objectContaining({
          pendingDocs: 1,
          indexFilter: 'agent_runs',
          windowStart: expect.any(String),
          windowEnd: expect.any(String),
        }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('runFetch', () => {
    it('logs scheduler.runFetch.finalFlushFailed and rethrows when the closing flush rejects', async () => {
      // runFetch is harder to unit test (calls init + getMinMaxTimestamp),
      // but the final-flush block is the only path that carries pendingDocs
      // context into the runScheduledFetch catch. Without a test, removing
      // the logger.error before rethrow would be silent.
      // Mock getMinMaxTimestamp dependencies: pioneer + katana max_ts agg
      // queries return null so backfill defaults kick in. Then katana
      // scroll returns nothing so the only processable line comes from
      // a single Loki page.
      const searchMock = vi.mocked(esClient.writeClient.search);
      searchMock.mockReset();
      searchMock.mockResolvedValue({
        aggregations: { max_ts: {} },
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      const scrollMock = vi.mocked(esClient.writeClient.scroll);
      scrollMock.mockReset();
      scrollMock.mockResolvedValue({
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValue(undefined as never);

      const pioneerLine = JSON.stringify({
        event: 'agent.run.finish',
        app_id: 'app-1',
        agentId: 'agent-1',
        data: {
          agentName: 'a',
          finishReason: 'stop',
          steps: 1,
          totalUsage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
        },
      });
      // First fetch returns one matching line; subsequent chunks return empty
      // so the test doesn't depend on how many daily windows runFetch creates
      // before defaulting to 30 days.
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { result: [{ stream: {}, values: [['1000000000000000001', pioneerLine]] }] },
        }),
        text: async () => '',
      } as unknown as Response).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response);
      global.fetch = fetchMock as unknown as typeof fetch;

      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();
      flushMock.mockRejectedValueOnce(new Error('runFetch flush boom'));

      await expect(runFetch()).rejects.toThrow('runFetch flush boom');
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.runFetch.finalFlushFailed',
        expect.objectContaining({
          pendingDocs: 1,
          windowStart: expect.any(String),
          windowEnd: expect.any(String),
        }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it('always calls the final flush even when pendingCount is 0 so re-queued un-attempted batches do not leak', async () => {
      // The final flush is unconditional. A gate of `pendingCount > 0` would
      // leak un-attempted sub-batches re-queued by a previous mid-loop
      // flushPendingDocs throw (which resets pendingCount to 0 in its
      // finally block). Pin this so a "cleanup" PR can't re-introduce the
      // gate without a test failure.
      const searchMock = vi.mocked(esClient.writeClient.search);
      searchMock.mockReset();
      searchMock.mockResolvedValue({
        aggregations: { max_ts: {} },
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.scroll).mockResolvedValue({
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValue(undefined as never);

      // Empty Loki responses => zero docs ingested => pendingCount stays 0.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();
      flushMock.mockResolvedValue(0);

      await runFetch();

      expect(flushMock).toHaveBeenCalled();
    });
  });

  describe('fetchAndProcessKatanaErrors', () => {
    function makeKatanaSearch(hits: Array<{ _id: string; _source: Record<string, unknown> }>, scrollId = 'scroll-1') {
      return { _scroll_id: scrollId, hits: { hits } } as never;
    }

    function makeKatanaHit(id: string, appId: string, event = 'client.websocket.connection.error'): { _id: string; _source: Record<string, unknown> } {
      return {
        _id: id,
        _source: {
          '@timestamp': '2026-04-22T00:00:00Z',
          event,
          level: 'error',
          data: { appId, error: 'boom' },
        },
      };
    }

    it('processes hits across the initial search AND a non-empty scroll continuation', async () => {
      // Multi-page coverage. A regression that incremented processedCount
      // only on the initial page would silently halve the Katana count for
      // any window that spans multiple scroll batches.
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce(
        makeKatanaSearch([makeKatanaHit('k1', 'app-1'), makeKatanaHit('k2', 'app-2')]),
      );
      vi.mocked(esClient.writeClient.scroll)
        .mockResolvedValueOnce(makeKatanaSearch([makeKatanaHit('k3', 'app-3')]) as never)
        .mockResolvedValueOnce(makeKatanaSearch([]) as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const result = await runBackfill(1, 'client_errors');

      expect(result.katanaCount).toBe(3);
      expect(recordedInserts.map((i) => i.app_id).sort()).toEqual(['app-1', 'app-2', 'app-3']);
    });

    it('logs scheduler.katana.fetchFailed and rethrows when the initial ES search throws', async () => {
      // Used to swallow with console.error and return 0 as if successful.
      // Confirms the catch + rethrow contract so a permanent ES auth failure
      // doesn't silently pretend Katana is being ingested.
      vi.mocked(esClient.writeClient.search).mockRejectedValueOnce(new Error('ES auth denied'));
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      await expect(runBackfill(1, 'client_errors')).rejects.toThrow(/ES auth denied/);
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.katana.fetchFailed',
        expect.objectContaining({ processedCount: 0 }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it('logs scheduler.katana.midLoopFlushFailed (initial scroll phase) and rethrows once', async () => {
      // Pre-seed pendingCount one below FLUSH_THRESHOLD so a single
      // processable hit on the initial page tips it over and triggers
      // exactly one flush. Mirror of the Pioneer mid-loop flush-failure
      // test. Also verifies the no-double-log guard: the outer
      // scheduler.katana.fetchFailed must NOT fire when the inner catch
      // already logged scheduler.katana.midLoopFlushFailed - otherwise
      // operators get pointed at scroll/auth instead of the bulk write.
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce(
        makeKatanaSearch([makeKatanaHit('k1', 'app-1')]),
      );
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);
      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();
      flushMock.mockRejectedValueOnce(new Error('bulk index failed'));
      const pendingCount = { value: 999 };

      await expect(
        fetchAndProcessKatanaErrors(
          new Date('2026-04-22T00:00:00Z'),
          new Date('2026-04-22T01:00:00Z'),
          pendingCount,
        ),
      ).rejects.toThrow('bulk index failed');

      expect(pendingCount.value).toBe(0);
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.katana.midLoopFlushFailed',
        expect.objectContaining({
          pendingDocs: 1000,
          scrollPhase: 'initial',
          windowStart: '2026-04-22T00:00:00.000Z',
          windowEnd: '2026-04-22T01:00:00.000Z',
        }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
      const fetchFailedCalls = mockedLoggerError.mock.calls.filter(
        (call) => call[0] === 'scheduler.katana.fetchFailed',
      );
      expect(fetchFailedCalls).toHaveLength(0);
    });

    it('logs scheduler.katana.midLoopFlushFailed (continuation scroll phase) and rethrows once', async () => {
      // The while loop is gated by `response.hits.hits.length > 0`, so the
      // initial page must be non-empty for the continuation phase to
      // execute. Use a hit that processKatanaLog drops (no appId/siteId)
      // so pendingCount stays at 999 through the initial page; the
      // continuation page then delivers the tipping hit, which pushes
      // pendingCount to 1000 and triggers the failing flush.
      const dropHit = {
        _id: 'k0',
        _source: {
          '@timestamp': '2026-04-22T00:00:00Z',
          event: 'client.websocket.connection.error',
          level: 'error',
          data: { error: 'no app or site' },
        },
      };
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce(
        makeKatanaSearch([dropHit]),
      );
      vi.mocked(esClient.writeClient.scroll).mockResolvedValueOnce(
        makeKatanaSearch([makeKatanaHit('k1', 'app-1')]) as never,
      );
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);
      const flushMock = vi.mocked(esDb.flushPendingDocs);
      flushMock.mockClear();
      flushMock.mockRejectedValueOnce(new Error('bulk index failed (cont)'));
      const pendingCount = { value: 999 };

      await expect(
        fetchAndProcessKatanaErrors(
          new Date('2026-04-22T00:00:00Z'),
          new Date('2026-04-22T01:00:00Z'),
          pendingCount,
        ),
      ).rejects.toThrow('bulk index failed (cont)');

      expect(pendingCount.value).toBe(0);
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'scheduler.katana.midLoopFlushFailed',
        expect.objectContaining({
          pendingDocs: 1000,
          scrollPhase: 'continuation',
          windowStart: '2026-04-22T00:00:00.000Z',
          windowEnd: '2026-04-22T01:00:00.000Z',
        }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
      const fetchFailedCalls = mockedLoggerError.mock.calls.filter(
        (call) => call[0] === 'scheduler.katana.fetchFailed',
      );
      expect(fetchFailedCalls).toHaveLength(0);
    });

    it('logs scheduler.es.clearScrollFailed without breaking the successful backfill', async () => {
      // clearScroll runs in finally and must never escape — a regression
      // that re-throws here would turn a successful backfill into a failure.
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce(
        makeKatanaSearch([makeKatanaHit('k1', 'app-1')]),
      );
      vi.mocked(esClient.writeClient.scroll).mockResolvedValueOnce(
        makeKatanaSearch([]) as never,
      );
      vi.mocked(esClient.writeClient.clearScroll).mockRejectedValueOnce(new Error('clear scroll failed'));
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const result = await runBackfill(1, 'client_errors');

      expect(result.katanaCount).toBe(1);
      expect(mockedLoggerWarn).toHaveBeenCalledWith(
        'scheduler.es.clearScrollFailed',
        expect.objectContaining({
          message: expect.stringMatching(/clearScroll failed/),
        }),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('processKatanaLog', () => {
    it('falls back to siteId when appId is missing', async () => {
      // The OR fallback `data.appId || data.siteId` has no coverage for the
      // siteId branch. Removing it would silently drop site-scoped client
      // errors with no test failure.
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: {
          hits: [{
            _id: 'k1',
            _source: {
              '@timestamp': '2026-04-22T00:00:00Z',
              event: 'client.websocket.connection.error',
              level: 'error',
              data: { siteId: 'site-7', error: 'boom' },
            },
          }],
        },
      } as never);
      vi.mocked(esClient.writeClient.scroll).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const result = await runBackfill(1, 'client_errors');

      expect(result.katanaCount).toBe(1);
      expect(recordedInserts).toEqual([
        expect.objectContaining({ app_id: 'site-7' }),
      ]);
    });

    it('drops hits that are missing both appId and siteId', async () => {
      // processKatanaLog returns false for hits with neither identifier.
      // Without this test, removing the guard would let unattributable
      // client errors leak into the index with empty app_id, polluting
      // per-app dashboards.
      vi.mocked(esClient.writeClient.search).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: {
          hits: [
            {
              _id: 'k1',
              _source: {
                '@timestamp': '2026-04-22T00:00:00Z',
                event: 'client.websocket.connection.error',
                level: 'error',
                data: { error: 'no app or site' },
              },
            },
            {
              _id: 'k2',
              _source: {
                '@timestamp': '2026-04-22T00:00:00Z',
                event: 'client.websocket.connection.error',
                level: 'error',
                data: { appId: 'app-real', error: 'real one' },
              },
            },
          ],
        },
      } as never);
      vi.mocked(esClient.writeClient.scroll).mockResolvedValueOnce({
        _scroll_id: 'scroll-1',
        hits: { hits: [] },
      } as never);
      vi.mocked(esClient.writeClient.clearScroll).mockResolvedValueOnce(undefined as never);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
        text: async () => '',
      } as unknown as Response) as unknown as typeof fetch;

      const result = await runBackfill(1, 'client_errors');

      expect(result.katanaCount).toBe(1);
      expect(recordedInserts.map((i) => i.app_id)).toEqual(['app-real']);
    });
  });

  describe('partial JSON parse failures', () => {
    const start = new Date('2026-04-22T00:00:00Z');
    const end = new Date('2026-04-22T01:00:00Z');

    it('warns (not errors) when SOME matched lines fail JSON.parse but others succeed', async () => {
      // The 100% failure path is covered above and escalates to error; the
      // partial path must stay at warn or the noisy partial drop pages
      // on-call for every malformed line. This pins parsedMatchedLines>0
      // to the warn branch in fetchAndProcessPioneerEvents.
      const goodLine = JSON.stringify({
        event: 'agent.run.finish',
        app_id: 'app-1',
        agentId: 'agent-1',
        data: {
          agentName: 'a',
          finishReason: 'stop',
          steps: 1,
          totalUsage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
        },
      });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', goodLine],
        ['1000000000000000002', '{"event":"agent.run.finish",broken'],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({ 'agent.run.finish': 1 });
      expect(mockedLoggerWarn).toHaveBeenCalledWith(
        'scheduler.loki.jsonParseFailures',
        expect.objectContaining({
          jsonParseFailures: 1,
          parsedMatchedLines: 1,
        }),
      );
      const dupAtError = mockedLoggerError.mock.calls.find(
        (call) => call[0] === 'scheduler.loki.jsonParseFailures',
      );
      expect(dupAtError).toBeUndefined();
    });
  });

  describe('app_id field extraction', () => {
    const start = new Date('2026-04-22T00:00:00Z');
    const end = new Date('2026-04-22T01:00:00Z');

    it('falls back to camelCase appId when snake_case app_id is absent', async () => {
      // Some emitter sites use camelCase by accident. Without this fallback
      // the line gets dropped by processPioneerLog (no app_id) and the
      // analytics view silently underreports for those services. Pinning
      // the fallback prevents a future cleanup from removing it without
      // realising downstream impact.
      const camelLine = JSON.stringify({
        event: 'agent.run.finish',
        appId: 'camel-app',
        agentId: 'agent-1',
        data: {
          agentName: 'a',
          finishReason: 'stop',
          steps: 1,
          totalUsage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
        },
      });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', camelLine],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(start, end, ['agent.run.finish'], { value: 0 });

      expect(counts).toEqual({ 'agent.run.finish': 1 });
      expect(recordedInserts.map((i) => i.app_id)).toEqual(['camel-app']);
    });
  });

  describe('route.publish sub-step events', () => {
    const start = new Date('2026-04-22T00:00:00Z');
    const end = new Date('2026-04-22T01:00:00Z');

    it('acknowledges default.begin / paas.begin / supervisor.begin without indexing them', async () => {
      // These three are intentionally absorbed by processPioneerLog (return
      // true with no insert) so they're counted as "processed" but don't
      // double-count the publish funnel against route.publish.begin /
      // strategy-selected. Pin the contract: counts include them, but
      // insertPublishEvent is not called.
      const subStepLine = (event: string, appId: string) => JSON.stringify({
        event,
        app_id: appId,
        data: {},
      });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', subStepLine('route.publish.default.begin', 'app-1')],
        ['1000000000000000002', subStepLine('route.publish.paas.begin', 'app-2')],
        ['1000000000000000003', subStepLine('route.publish.supervisor.begin', 'app-3')],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const events = [
        'route.publish.default.begin',
        'route.publish.paas.begin',
        'route.publish.supervisor.begin',
      ];
      const counts = await fetchAndProcessPioneerEvents(start, end, events, { value: 0 });

      expect(counts).toEqual({
        'route.publish.default.begin': 1,
        'route.publish.paas.begin': 1,
        'route.publish.supervisor.begin': 1,
      });
      expect(esDb.insertPublishEvent).not.toHaveBeenCalled();
    });

    it('routes strategy-selected and legacy begin to event_type=begin', async () => {
      // strategy-selected is the canonical "begin" — publish funnel
      // dashboards depend on this dispatch. A regression that mapped it to
      // a different event_type (or dropped it) would break analytics
      // silently. Legacy 'route.publish.begin' must produce the same shape
      // so historical and new logs are comparable.
      const buildLine = (event: string, appId: string) => JSON.stringify({
        event,
        app_id: appId,
        data: {},
      });
      const lines: Array<[string, string]> = [
        ['1000000000000000001', buildLine('route.publish.strategy-selected', 'app-1')],
        ['1000000000000000002', buildLine('route.publish.begin', 'app-2')],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(
        start,
        end,
        ['route.publish.strategy-selected', 'route.publish.begin'],
        { value: 0 },
      );

      expect(counts).toEqual({
        'route.publish.strategy-selected': 1,
        'route.publish.begin': 1,
      });
      expect(esDb.insertPublishEvent).toHaveBeenCalledTimes(2);
      const publishEvents = recordedInserts.filter((i) => i.event.startsWith('publish:'));
      expect(publishEvents.map((i) => ({ app_id: i.app_id, event_type: i.event.replace('publish:', '') }))).toEqual([
        { app_id: 'app-1', event_type: 'begin' },
        { app_id: 'app-2', event_type: 'begin' },
      ]);
    });

    it('routes route.publish.success to event_type=success and forwards commit_hash + success=true', async () => {
      // Assert the full insertPublishEvent payload (not just event_type) so
      // a regression that drops commit_hash or flips success would be
      // caught. The success-path dashboards key off both fields.
      const lines: Array<[string, string]> = [
        ['1000000000000000001', JSON.stringify({
          event: 'route.publish.success',
          app_id: 'app-1',
          data: { commitHash: 'abc123' },
        })],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(
        start,
        end,
        ['route.publish.success'],
        { value: 0 },
      );

      expect(counts).toEqual({ 'route.publish.success': 1 });
      expect(esDb.insertPublishEvent).toHaveBeenCalledTimes(1);
      expect(esDb.insertPublishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'app-1',
          event_type: 'success',
          success: true,
          commit_hash: 'abc123',
        }),
      );
    });

    it('routes route.publish.supervisor.failed to event_type=other_failed with truncated error_message', async () => {
      // supervisor.failed maps to a distinct event_type (other_failed) so
      // the failure-rate dashboards can split supervisor crashes from
      // build/archive faults. error_message is truncated to 2000 chars to
      // avoid blowing up the index payload.
      const longError = 'x'.repeat(2500);
      const lines: Array<[string, string]> = [
        ['1000000000000000001', JSON.stringify({
          event: 'route.publish.supervisor.failed',
          app_id: 'app-1',
          data: { error: longError },
        })],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(
        start,
        end,
        ['route.publish.supervisor.failed'],
        { value: 0 },
      );

      expect(counts).toEqual({ 'route.publish.supervisor.failed': 1 });
      expect(esDb.insertPublishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'app-1',
          event_type: 'other_failed',
          success: false,
          error_message: 'x'.repeat(2000),
        }),
      );
    });

    it('routes route.publish.*.archive.failed (canonical and legacy) to event_type=archive_failed', async () => {
      // Canonical (default/paas), generic (route.publish.archive.failed),
      // and legacy (git-archive.failed) variants must all collapse to the
      // same event_type. A regression that left git-archive.failed as a
      // separate type would split the archive-failure metric across two
      // buckets and skew dashboards.
      const lines: Array<[string, string]> = [
        ['1000000000000000001', JSON.stringify({
          event: 'route.publish.default.archive.failed',
          app_id: 'app-1',
          data: { error: 'tar failed' },
        })],
        ['1000000000000000002', JSON.stringify({
          event: 'route.publish.paas.archive.failed',
          app_id: 'app-2',
          data: { error: 'paas archive failed' },
        })],
        ['1000000000000000003', JSON.stringify({
          event: 'route.publish.archive.failed',
          app_id: 'app-3',
          data: { error: 'generic archive failed' },
        })],
        ['1000000000000000004', JSON.stringify({
          event: 'route.publish.git-archive.failed',
          app_id: 'app-4',
          data: { error: 'git archive failed' },
        })],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(
        start,
        end,
        [
          'route.publish.default.archive.failed',
          'route.publish.paas.archive.failed',
          'route.publish.archive.failed',
          'route.publish.git-archive.failed',
        ],
        { value: 0 },
      );

      expect(counts).toEqual({
        'route.publish.default.archive.failed': 1,
        'route.publish.paas.archive.failed': 1,
        'route.publish.archive.failed': 1,
        'route.publish.git-archive.failed': 1,
      });
      const publishEvents = recordedInserts.filter((i) => i.event.startsWith('publish:'));
      expect(publishEvents.map((i) => i.event)).toEqual([
        'publish:archive_failed',
        'publish:archive_failed',
        'publish:archive_failed',
        'publish:archive_failed',
      ]);
    });

    it('routes route.publish.*.build.failed to event_type=build_failed (canonical and legacy)', async () => {
      // Canonical (default/paas) and legacy (route.publish.build.failed)
      // must collapse to the same event_type so failure rate dashboards
      // don't see a mysterious gap during the migration window.
      const lines: Array<[string, string]> = [
        ['1000000000000000001', JSON.stringify({
          event: 'route.publish.default.build.failed',
          app_id: 'app-1',
          data: { stderr: 'compile error', commitHash: 'def456' },
        })],
        ['1000000000000000002', JSON.stringify({
          event: 'route.publish.paas.build.failed',
          app_id: 'app-2',
          data: { stderr: 'paas pipeline error' },
        })],
        ['1000000000000000003', JSON.stringify({
          event: 'route.publish.build.failed',
          app_id: 'app-3',
          data: { stderr: 'legacy build error' },
        })],
      ];
      global.fetch = mockFetchSequence([
        { result: [{ stream: {}, values: lines }] },
      ]) as unknown as typeof fetch;

      const counts = await fetchAndProcessPioneerEvents(
        start,
        end,
        [
          'route.publish.default.build.failed',
          'route.publish.paas.build.failed',
          'route.publish.build.failed',
        ],
        { value: 0 },
      );

      expect(counts).toEqual({
        'route.publish.default.build.failed': 1,
        'route.publish.paas.build.failed': 1,
        'route.publish.build.failed': 1,
      });
      const publishEvents = recordedInserts.filter((i) => i.event.startsWith('publish:'));
      expect(publishEvents.map((i) => i.event)).toEqual([
        'publish:build_failed',
        'publish:build_failed',
        'publish:build_failed',
      ]);
    });
  });
});
