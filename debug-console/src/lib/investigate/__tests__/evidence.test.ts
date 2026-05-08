import { describe, expect, it } from 'vitest';

import type { LogSourceConfig } from '@/lib/log-sources';
import {
  buildEvidenceIndex,
  buildLokiEvidenceQuery,
  collectElasticsearchEvidence,
  collectInvestigateEvidence,
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

  it('normalizes evidence requests to bounded known sources', () => {
    const normalized = normalizeEvidenceRequest({
      appId: 'app123',
      timeWindow: '14d',
      sources: ['airo-preview', 'unknown', 'control_plane', 'airo-preview'],
      bucketHours: 0,
    });

    expect(normalized.appId).toBe('app123');
    expect(normalized.timeWindow).toBe('7d');
    expect(normalized.sources).toEqual(['airo-preview', 'control_plane']);
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
    } finally {
      process.env = originalEnv;
    }
  });
});
