import { describe, expect, it } from 'vitest';

import type { LogSourceConfig } from '@/lib/log-sources';
import {
  buildEvidenceIndex,
  buildLokiEvidenceQuery,
  collectElasticsearchEvidence,
  collectFullstoryEvidence,
  collectInvestigateEvidence,
  collectLangfuseEvidence,
  collectLokiEvidence,
  normalizeEvidenceRequest,
} from '../evidence';

const lokiSource = {
  id: 'airo-preview',
  name: 'Preview App',
  description: 'Preview logs',
  backendType: 'loki',
  lokiEndpoint: 'https://loki.test',
  lokiLabels: { job: 'airo-preview-application', env: 'prod' },
  environment: 'prod',
  fieldMapping: {
    appIdField: 'app_id',
    appIdQueryType: 'term',
    timestampField: '@timestamp',
    levelField: 'level',
    levelKeywordField: 'level.keyword',
    messageField: 'msg',
    messageKeywordField: 'msg.keyword',
    eventField: 'type',
    eventKeywordField: 'type.keyword',
    serviceField: 'com.hashicorp.nomad.task_name',
    serviceKeywordField: 'com.hashicorp.nomad.task_name',
    displayFields: [],
  },
} satisfies LogSourceConfig;

const elasticsearchSource = {
  id: 'airo-app',
  name: 'Airo App',
  description: 'Frontend logs',
  backendType: 'elasticsearch',
  endpoint: 'https://es.test',
  index: 'logs-*',
  apiKey: 'key',
  fieldMapping: {
    appIdField: 'app_id',
    appIdQueryType: 'term',
    timestampField: '@timestamp',
    levelField: 'level',
    levelKeywordField: 'level.keyword',
    messageField: 'message',
    messageKeywordField: 'message.keyword',
    eventField: 'event',
    eventKeywordField: 'event.keyword',
    serviceField: 'service',
    serviceKeywordField: 'service.keyword',
    displayFields: [],
  },
} satisfies LogSourceConfig;

describe('investigate evidence collection', () => {
  it('builds Loki evidence queries with labels and early app_id line filter', () => {
    const query = buildLokiEvidenceQuery(lokiSource, 'app123');

    expect(query).toBe('{job="airo-preview-application",env="prod"} |= "\\"app_id\\":\\"app123\\""');
  });

  it('paginates Loki forward without dropping same-nanosecond entries', async () => {
    const requestedStarts: string[] = [];
    const responses = [
      {
        status: 'success',
        data: {
          result: [
            {
              stream: { job: 'airo-preview-application' },
              values: [
                ['1000000000', '{"app_id":"app123","level":"INFO","msg":"first"}'],
                ['2000000000', '{"app_id":"app123","level":"INFO","msg":"second"}'],
              ],
            },
          ],
        },
      },
      {
        status: 'success',
        data: {
          result: [
            {
              stream: { job: 'airo-preview-application' },
              values: [
                ['2000000000', '{"app_id":"app123","level":"INFO","msg":"second"}'],
                ['2000000000', '{"app_id":"app123","level":"ERROR","msg":"third"}'],
              ],
            },
          ],
        },
      },
      {
        status: 'success',
        data: { result: [] },
      },
    ];

    const fakeFetch = async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      requestedStarts.push(requestUrl.searchParams.get('start') || '');
      const body = responses.shift();
      return new Response(JSON.stringify(body), { status: 200 });
    };

    const result = await collectLokiEvidence({
      sourceConfig: lokiSource,
      appId: 'app123',
      startTime: new Date(1_000),
      endTime: new Date(3_000),
      limit: 2,
      timeoutMs: 1_000,
      fetchImpl: fakeFetch,
    });

    expect(result.logs.map((log) => log.message)).toEqual(['first', 'second', 'third']);
    expect(result.diagnostics.pageCount).toBe(3);
    expect(requestedStarts).toEqual(['1000000000', '2000000000', '2000000000']);
    expect(result.complete).toBe(true);
  });

  it('marks Loki collection incomplete when the cursor cannot advance', async () => {
    const repeatedPage = {
      status: 'success',
      data: {
        result: [
          {
            stream: { job: 'airo-preview-application' },
            values: [
              ['1000000000', '{"app_id":"app123","level":"INFO","msg":"first"}'],
              ['1000000000', '{"app_id":"app123","level":"INFO","msg":"second"}'],
            ],
          },
        ],
      },
    };
    let callCount = 0;
    const fakeFetch = async () => {
      callCount += 1;
      return new Response(JSON.stringify(repeatedPage), { status: 200 });
    };

    const result = await collectLokiEvidence({
      sourceConfig: lokiSource,
      appId: 'app123',
      startTime: new Date(1_000),
      endTime: new Date(2_000),
      limit: 2,
      timeoutMs: 1_000,
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(false);
    expect(result.incomplete[0].error).toContain('Loki cursor stuck');
    expect(result.diagnostics.pageCount).toBe(2);
    expect(callCount).toBe(2);
  });

  it('records Elasticsearch fetch failures with bucket timing context', async () => {
    const result = await collectElasticsearchEvidence({
      sourceConfig: elasticsearchSource,
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      bucketLabel: 'b000',
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });

    expect(result.complete).toBe(false);
    expect(result.incomplete[0]).toMatchObject({
      bucket: 'b000',
      start: '2026-05-08T00:00:00.000Z',
      end: '2026-05-08T01:00:00.000Z',
    });
    expect(result.incomplete[0].error).toContain('network down');
    expect(result.diagnostics.error).toContain('network down');
  });

  it('records Elasticsearch non-JSON responses as incomplete buckets', async () => {
    const result = await collectElasticsearchEvidence({
      sourceConfig: elasticsearchSource,
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      bucketLabel: 'b000',
      fetchImpl: async () => new Response('not json', { status: 200 }),
    });

    expect(result.complete).toBe(false);
    expect(result.incomplete[0].error).toContain('non-JSON response');
    expect(result.diagnostics.pageCount).toBe(1);
  });


  it('collects Langfuse traces across pages and fetches trace details', async () => {
    const requestedUrls: string[] = [];
    const details: Record<string, Record<string, unknown>> = {
      trace1: { id: 'trace1', name: 'agent-turn', timestamp: '2026-05-08T00:10:00.000Z', sessionId: 'session-a', metadata: { business_data_appId: 'app123' }, observations: [{ id: 'obs1', type: 'GENERATION', name: 'agent', level: 'DEFAULT', statusMessage: 'tool completed', totalTokens: 100 }] },
      trace2: { id: 'trace2', name: 'tool-error', timestamp: '2026-05-08T00:20:00.000Z', sessionId: 'session-a', metadata: { business_data_appId: 'app123' }, observations: [{ id: 'obs2', type: 'SPAN', name: 'tool', level: 'ERROR', statusMessage: 'tool failed' }] },
    };
    const fakeFetch = async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      requestedUrls.push(requestUrl.toString());
      if (requestUrl.pathname === '/api/public/traces') {
        const page = requestUrl.searchParams.get('page');
        const data = page === '1' ? [{ id: 'trace1' }] : [{ id: 'trace2' }];
        return new Response(JSON.stringify({ data, meta: { totalPages: 2, totalItems: 2 } }), { status: 200 });
      }
      const id = requestUrl.pathname.split('/').pop() || '';
      return new Response(JSON.stringify(details[id]), { status: 200 });
    };

    const result = await collectLangfuseEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      langfuse: { baseUrl: 'https://langfuse.test', authHeader: 'Basic token' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(true);
    expect(result.rawPages).toHaveLength(2);
    expect(result.rawPages.flatMap((page) => page.logs).map((log) => log.id)).toEqual(['trace1', 'trace2']);
    expect(result.rawPages[0].logs[0].level).toBe('info');
    expect(result.rawPages[1].logs[0].level).toBe('error');
    expect(result.diagnostics.pageCount).toBe(2);
    const listUrls = requestedUrls.filter((url) => new URL(url).pathname === '/api/public/traces');
    expect(listUrls.map((url) => new URL(url).searchParams.get('page'))).toEqual(['1', '2']);
    for (const url of listUrls) {
      const searchParams = new URL(url).searchParams;
      expect(searchParams.get('filter')).toContain('business_data_appId');
      expect(searchParams.get('fromTimestamp')).toBe('2026-05-08T00:00:00.000Z');
      expect(searchParams.get('toTimestamp')).toBe('2026-05-08T01:00:00.000Z');
    }
  });


  it('continues Langfuse pagination when an intermediate page is empty', async () => {
    const requestedUrls: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      requestedUrls.push(requestUrl.toString());
      if (requestUrl.pathname === '/api/public/traces') {
        const page = requestUrl.searchParams.get('page');
        const data = page === '2' ? [{ id: 'trace2' }] : [];
        return new Response(JSON.stringify({ data, meta: { totalPages: 2, totalItems: 1 } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'trace2',
        name: 'late-trace',
        timestamp: '2026-05-08T00:20:00.000Z',
        observations: [],
      }), { status: 200 });
    };

    const result = await collectLangfuseEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      langfuse: { baseUrl: 'https://langfuse.test', authHeader: 'Basic token' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(true);
    expect(result.diagnostics.pageCount).toBe(2);
    expect(result.rawPages.flatMap((page) => page.logs).map((log) => log.id)).toEqual(['trace2']);
    const listUrls = requestedUrls.filter((url) => new URL(url).pathname === '/api/public/traces');
    expect(listUrls.map((url) => new URL(url).searchParams.get('page'))).toEqual(['1', '2']);
  });


  it('stops Langfuse collection when the wall-clock budget is exceeded', async () => {
    // Simulate a slow Langfuse server: each list page takes ~2 minutes of
    // monotonic wall-clock. Two pages should be enough to trip the 4-minute
    // budget before the 200-page limit.
    const originalNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    try {
      const requestedPages: string[] = [];
      const fakeFetch = async (url: string | URL | Request) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === '/api/public/traces') {
          requestedPages.push(requestUrl.searchParams.get('page') || '');
          now += 2 * 60 * 1000 + 500; // advance wall clock by ~2 minutes per page
        }
        return new Response(JSON.stringify({ data: [], meta: { totalPages: 50, totalItems: 0 } }), { status: 200 });
      };

      const result = await collectLangfuseEvidence({
        appId: 'app-slow',
        startTime: new Date('2026-05-08T00:00:00.000Z'),
        endTime: new Date('2026-05-08T01:00:00.000Z'),
        langfuse: { baseUrl: 'https://langfuse.test', authHeader: 'Basic token' },
        fetchImpl: fakeFetch,
      });

      expect(result.complete).toBe(false);
      expect(result.incomplete.at(-1)?.error).toMatch(/exceeded .* budget/);
      // Shouldn't have walked anywhere close to the 200-page limit.
      expect(requestedPages.length).toBeLessThan(10);
    } finally {
      Date.now = originalNow;
    }
  });

  it('marks Langfuse evidence incomplete when the page limit is reached', async () => {
    const requestedPages: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      requestedPages.push(requestUrl.searchParams.get('page') || '');
      return new Response(JSON.stringify({ data: [], meta: { totalPages: 201, totalItems: 0 } }), { status: 200 });
    };

    const result = await collectLangfuseEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      langfuse: { baseUrl: 'https://langfuse.test', authHeader: 'Basic token' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(false);
    expect(result.diagnostics.pageCount).toBe(200);
    expect(requestedPages.at(-1)).toBe('200');
    expect(result.incomplete.at(-1)?.error).toContain('Langfuse page limit reached');
  });

  it('stops Langfuse collection after too many trace detail failures', async () => {
    const requestedListPages: string[] = [];
    const traceIds = Array.from({ length: 25 }, (_, index) => ({ id: `trace-${index}` }));
    const fakeFetch = async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname === '/api/public/traces') {
        requestedListPages.push(requestUrl.searchParams.get('page') || '');
        return new Response(JSON.stringify({ data: traceIds, meta: { totalPages: 2, totalItems: traceIds.length * 2 } }), { status: 200 });
      }
      return new Response('forbidden', { status: 403 });
    };

    const result = await collectLangfuseEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      langfuse: { baseUrl: 'https://langfuse.test', authHeader: 'Basic token' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(false);
    expect(requestedListPages).toEqual(['1']);
    expect(result.incomplete).toHaveLength(6);
    expect(result.incomplete.at(-1)?.error).toContain('too many Langfuse trace detail failures');
  });

  it('marks Langfuse evidence incomplete when trace details fail', async () => {
    const fakeFetch = async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname === '/api/public/traces') {
        return new Response(JSON.stringify({ data: [{ id: 'trace1' }], meta: { totalPages: 1, totalItems: 1 } }), { status: 200 });
      }
      return new Response('missing', { status: 502 });
    };

    const result = await collectLangfuseEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      langfuse: { baseUrl: 'https://langfuse.test', authHeader: 'Basic token' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(false);
    expect(result.incomplete[0].bucket).toBe('p001');
    expect(result.incomplete[0].error).toContain('trace detail trace1 HTTP 502');
    expect(result.diagnostics.error).toContain('trace detail trace1 HTTP 502');
  });

  it('normalizes evidence requests to bounded known sources', () => {
    const normalized = normalizeEvidenceRequest({
      appId: 'app123',
      timeWindow: '14d',
      sources: ['airo-preview', 'unknown', 'control_plane', 'langfuse', 'fullstory', 'airo-preview'],
      bucketHours: 0,
      fullstoryUrl: '  https://app.fullstory.com/ui/YKBRC/session/111:222  ',
    });

    expect(normalized.appId).toBe('app123');
    expect(normalized.timeWindow).toBe('7d');
    expect(normalized.sources).toEqual(['airo-preview', 'control_plane', 'langfuse', 'fullstory']);
    expect(normalized.bucketHours).toBe(6);
    expect(normalized.fullstoryUrl).toBe('https://app.fullstory.com/ui/YKBRC/session/111:222');
  });

  it('builds compact indexes with per-source coverage and raw refs', () => {
    const index = buildEvidenceIndex({
      source: lokiSource,
      appId: 'app123',
      window: { label: '1h', start: '2026-05-08T00:00:00.000Z', end: '2026-05-08T01:00:00.000Z' },
      rawPages: [
        {
          page: 0,
          bucket: 'b000',
          start: '2026-05-08T00:00:00.000Z',
          end: '2026-05-08T01:00:00.000Z',
          logs: [
            { timestamp: '2026-05-08T00:10:00.000Z', level: 'error', message: 'Preview failed 500', sourceId: 'airo-preview', raw: {} },
          ],
        },
      ],
      incomplete: [],
      diagnostics: { elapsedMs: 12, pageCount: 1, query: 'query', truncated: false },
    });

    expect(index.coverage).toMatchObject({ complete: true, fetchedLogCount: 1, incompleteBucketCount: 0 });
    expect(index.rawRefs).toEqual(['airo-preview/b000-p0000.json#$.logs[*]']);
    expect(index.rareErrorSignatures[0].signature).toContain('Preview failed #');
  });

  it('fetches a single FullStory session when a URL is provided', async () => {
    const requestedTools: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string; arguments: Record<string, unknown> } };
      requestedTools.push({ name: body.params.name, args: body.params.arguments });
      if (body.params.name === 'get_session_events') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                events: '[00:00] Navigate To Page: /develop/app123\n(+2s) click: [button Submit]\n(+5s) rage-click: [button Submit]\n(+7s) console-error: TypeError: undefined',
                session_url: 'https://app.fullstory.com/ui/YKBRC/session/999:888',
              }),
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected tool ${body.params.name}`);
    };

    const result = await collectFullstoryEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fullstoryUrl: 'https://app.fullstory.com/ui/YKBRC/session/999:888?utm=x',
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(true);
    expect(requestedTools).toHaveLength(1);
    expect(requestedTools[0].name).toBe('get_session_events');
    expect(requestedTools[0].args).toEqual({ device_id: '999', session_id: '888' });
    expect(result.rawPages).toHaveLength(1);
    const logs = result.rawPages[0].logs;
    expect(logs.map((log) => log.level)).toContain('error');
    expect(logs.some((log) => /rage-click/i.test(log.message))).toBe(true);
    expect(result.diagnostics.query).toContain('fullstoryUrl=');
  });

  it('classifies pain events as errors, preserves them past the boring-event budget, and emits session-relative timestamps', async () => {
    // 450 boring clicks first, then 5 pain events. Budget-trim logic must drop
    // boring events >400 while keeping every pain event, and timestamps must
    // be anchored to the Unix epoch (session-relative) rather than wall-clock.
    const boring = Array.from({ length: 1100 }, (_, i) => `(+1s) click: [button #${i}]`).join('\n');
    const pain = [
      '(+2s) rage-click: [button checkout]',
      '(+3s) dead-click: [link #foo]',
      '(+4s) error-click: [form submit]',
      '(+5s) console-error: TypeError undefined',
      '(+6s) feedback: text=broken',
    ].join('\n');
    const events = `[00:00] Navigate To Page: /develop/app-pain\n${boring}\n${pain}`;

    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      if (body.params.name !== 'get_session_events') throw new Error(`unexpected ${body.params.name}`);
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify({ events }) }] },
      }), { status: 200 });
    };

    // URL without epoch-ms anchor -> session-relative 1970 timestamps.
    const result = await collectFullstoryEvidence({
      appId: 'app-pain',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fullstoryUrl: 'https://app.fullstory.com/ui/YKBRC/session/111:222',
      fetchImpl: fakeFetch,
    });

    const logs = result.rawPages.flatMap((p) => p.logs);
    const errors = logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(5);
    expect(errors.map((l) => l.event)).toEqual(
      expect.arrayContaining(['rage-click', 'dead-click', 'error-click', 'console-error', 'feedback']),
    );
    // All 5 pain events retained even though total far exceeds budget.
    expect(logs.length).toBeGreaterThanOrEqual(1000 + 5);
    // No URL anchor -> session-relative 1970 timestamps.
    expect(logs[0].timestamp).toMatch(/^1970-01-01T/);
    expect(result.diagnostics.notes?.some((n) => /did not include an epoch-ms anchor/.test(n))).toBe(true);
  });

  it('uses the URL epoch-ms anchor to emit real UTC timestamps when present', async () => {
    // Short session: one navigate + one click at +3s.
    const eventsText = '[00:00] Navigate To Page: /develop/app-anchor\n(+3s) click: [button Submit]';
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      if (body.params.name !== 'get_session_events') throw new Error(`unexpected ${body.params.name}`);
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify({ events: eventsText }) }] },
      }), { status: 200 });
    };

    // Anchor at 2026-05-11T00:00:03.000Z (matches last event at +3s).
    const anchorMs = Date.parse('2026-05-11T00:00:03.000Z');
    const result = await collectFullstoryEvidence({
      appId: 'app-anchor',
      startTime: new Date('2026-05-11T00:00:00.000Z'),
      endTime: new Date('2026-05-11T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fullstoryUrl: `https://app.fullstory.com/ui/YKBRC/session/111:222:${anchorMs}`,
      fetchImpl: fakeFetch,
    });

    const logs = result.rawPages.flatMap((p) => p.logs);
    expect(logs).toHaveLength(2);
    // First event at offset 0 = sessionStart = anchorMs - maxOffset (3000ms) = 2026-05-11T00:00:00.000Z
    expect(logs[0].timestamp).toBe('2026-05-11T00:00:00.000Z');
    // Last event at offset 3s = anchor itself.
    expect(logs[1].timestamp).toBe('2026-05-11T00:00:03.000Z');
  });

  it('marks fullstoryUrl incomplete without falling back when the URL is unparseable', async () => {
    const calls: string[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      calls.push(body.params.name);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }] } }), { status: 200 });
    };

    const result = await collectFullstoryEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fullstoryUrl: 'definitely not a url',
      fetchImpl: fakeFetch,
    });

    expect(calls).toHaveLength(0);
    expect(result.complete).toBe(false);
    expect(result.incomplete[0].error).toContain('unparseable FullStory URL');
  });

  it('falls back to segment discovery when a UUID client-session URL is provided', async () => {
    const requestedTools: string[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      requestedTools.push(body.params.name);
      const payloadText =
        body.params.name === 'build_segment'
          ? '{"segment_id":"seg-uuid"}'
          : body.params.name === 'get_sessions'
            ? '{"sessions":[{"device_id":111,"session_id":222,"session_url":"https://app.fullstory.com/ui/YKBRC/session/111:222"}]}'
            : '{"events":"[00:00] Navigate To Page: /develop/app123"}';
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: payloadText }] },
      }), { status: 200 });
    };

    const result = await collectFullstoryEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fullstoryUrl: 'https://app.fullstory.com/ui/YKBRC/client-session/5e943252-1930-4b13-9d46-299c1d7ca5a6%3A53082a41-72a0-4415-bbae-4664f5b753dd%3A1778483472715',
      fetchImpl: fakeFetch,
    });

    expect(requestedTools).toEqual(['build_segment', 'get_sessions', 'get_session_events']);
    expect(result.rawPages).toHaveLength(1);
    // UUID fallback is a deliberate path choice, not missing coverage. The
    // note lives in diagnostics.notes; incomplete[] stays empty.
    expect(result.complete).toBe(true);
    expect(result.incomplete).toHaveLength(0);
    expect(result.diagnostics.notes?.[0]).toContain('UUID client-session');
  });

  it('discovers FullStory sessions via build_segment + get_sessions when no URL is provided', async () => {
    const requestedTools: string[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      requestedTools.push(body.params.name);
      // Build raw JSON text so BigInt ids survive intact (JS number literals
      // above 2^53 lose precision).
      const payloadText =
        body.params.name === 'build_segment'
          ? '{"segment_id":"seg-42","segment_name":"airo-investigate-app123"}'
          : body.params.name === 'get_sessions'
            ? '{"sessions":[{"device_id":127298234807956416,"session_id":3903954582762836713,"session_url":"https://app.fullstory.com/ui/YKBRC/session/127298234807956416:3903954582762836713"},{"device_id":11,"session_id":22,"session_url":"https://app.fullstory.com/ui/YKBRC/session/11:22"}]}'
            : '{"events":"[00:00] Navigate To Page: /develop/app123\\n(+3s) click: [button Submit]"}';

      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: payloadText }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await collectFullstoryEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(true);
    expect(requestedTools[0]).toBe('build_segment');
    expect(requestedTools[1]).toBe('get_sessions');
    expect(requestedTools.slice(2)).toEqual(['get_session_events', 'get_session_events']);
    expect(result.rawPages).toHaveLength(2);
    expect(result.rawPages[0].bucket).toContain('3903954582762836713');
  });

  it('notes the session-list trim when the segment returns more sessions than the fetch cap', async () => {
    // Build 5 sessions; expect 3 fetched + an informational note about the
    // 2 leftovers, with complete=true (trim is deliberate, not missing coverage).
    const manySessions = Array.from({ length: 5 }, (_, i) => (
      `{"device_id":${100 + i},"session_id":${200 + i},"session_url":"https://app.fullstory.com/ui/YKBRC/session/${100 + i}:${200 + i}"}`
    )).join(',');
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      const payloadText =
        body.params.name === 'build_segment'
          ? '{"segment_id":"seg-many"}'
          : body.params.name === 'get_sessions'
            ? `{"sessions":[${manySessions}]}`
            : '{"events":"[00:00] Navigate To Page: /develop/busy"}';
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: payloadText }] },
      }), { status: 200 });
    };

    const result = await collectFullstoryEvidence({
      appId: 'busy',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(true);
    expect(result.rawPages).toHaveLength(3);
    expect(result.diagnostics.notes?.some((n) => /matched 5 sessions.*fetched the 3/.test(n))).toBe(true);
  });

  it('marks FullStory evidence incomplete when no sessions are found', async () => {
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { params: { name: string } };
      const payload = body.params.name === 'build_segment'
        ? { segment_id: 'seg-0' }
        : { sessions: [] };
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
      }), { status: 200 });
    };

    const result = await collectFullstoryEvidence({
      appId: 'empty',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(false);
    expect(result.rawPages).toHaveLength(0);
    expect(result.incomplete[0].error).toContain('no FullStory sessions found');
  });

  it('propagates FullStory MCP HTTP errors into incomplete buckets', async () => {
    const fakeFetch = async () => new Response('boom', { status: 500 });
    const result = await collectFullstoryEvidence({
      appId: 'app123',
      startTime: new Date('2026-05-08T00:00:00.000Z'),
      endTime: new Date('2026-05-08T01:00:00.000Z'),
      fullstory: { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic fake' },
      fetchImpl: fakeFetch,
    });

    expect(result.complete).toBe(false);
    expect(result.incomplete[0].bucket).toBe('discovery');
    expect(result.incomplete[0].error).toContain('MCP HTTP 500');
  });

  it('records per-source failures without skipping other requested sources', async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.LOKI_ENDPOINT;

    try {
      const result = await collectInvestigateEvidence({
        appId: 'app123',
        timeWindow: '24h',
        sources: ['airo-agents', 'control_plane'],
        bucketHours: 6,
      });

      expect(result.complete).toBe(false);
      expect(result.sources.map((source) => source.sourceId)).toEqual(['airo-agents', 'control_plane']);
      expect(result.sources.every((source) => source.complete === false)).toBe(true);
      expect(result.sources[0].index.coverage.incomplete[0].error).toMatch(/LOKI_ENDPOINT is required/);
      const failedWindow = result.sources[0].index.window;
      expect(failedWindow.label).toBe('24h');
      expect(new Date(failedWindow.end).getTime() - new Date(failedWindow.start).getTime()).toBeGreaterThan(23 * 60 * 60 * 1000);
    } finally {
      process.env = originalEnv;
    }
  });
});
