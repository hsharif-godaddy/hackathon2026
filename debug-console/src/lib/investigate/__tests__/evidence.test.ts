import { describe, expect, it } from 'vitest';

import type { LogSourceConfig } from '@/lib/log-sources';
import {
  buildEvidenceIndex,
  buildLokiEvidenceQuery,
  collectElasticsearchEvidence,
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
      sources: ['airo-preview', 'unknown', 'control_plane', 'langfuse', 'airo-preview'],
      bucketHours: 0,
    });

    expect(normalized.appId).toBe('app123');
    expect(normalized.timeWindow).toBe('7d');
    expect(normalized.sources).toEqual(['airo-preview', 'control_plane', 'langfuse']);
    expect(normalized.bucketHours).toBe(6);
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
