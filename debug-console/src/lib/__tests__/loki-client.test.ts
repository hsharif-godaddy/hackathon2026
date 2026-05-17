import { describe, expect, it } from 'vitest';

import {
  buildLokiQuery,
  transformLokiResponse,
  type LokiQueryResponse
} from '../loki-client';
import type { FieldMapping } from '../log-sources';

describe('loki-client', () => {
  describe('buildLokiQuery', () => {
    const mockConfig = {
      lokiEndpoint: 'https://loki.example.com',
      lokiApiKey: 'test-key',
      lokiLabels: {
        job: 'airo-agents',
        env: 'prod'
      },
      environment: 'prod' as const
    };

    it('should build basic query with labels only', async () => {
      const result = await buildLokiQuery({}, mockConfig);

      expect(result.query).toBe('{job="airo-agents",env="prod"}');
      expect(result.direction).toBe('backward');
      expect(result.limit).toBe(500); // MAX_LOKI_FETCH default
    });

    it('should add case-insensitive line filter for single level filter', async () => {
      const result = await buildLokiQuery(
        { levelFilter: 'error' },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error)\\""');
    });

    it('should use case-insensitive regex OR for multiple levels', async () => {
      const result = await buildLokiQuery(
        { levelsFilter: 'error,warn' },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error|warn)\\""');
    });

    it('should add line filter for app_id and omit cluster when not provided', async () => {
      const result = await buildLokiQuery(
        { appId: 'abc123' },
        mockConfig
      );

      // mockConfig has no `cluster` key in lokiLabels — query must not
      // constrain by cluster so apps whose allocation migrated still surface
      // logs. The route layer adds cluster only when an appId resolves to one.
      expect(result.query).not.toContain('cluster=');
      expect(result.query).toContain('|= "\\"app_id\\":\\"abc123\\""');
    });

    it('should add cluster label when present in lokiLabels', async () => {
      const result = await buildLokiQuery(
        { appId: 'abc123' },
        { ...mockConfig, lokiLabels: { ...mockConfig.lokiLabels, cluster: 'c37' } }
      );

      expect(result.query).toContain('cluster="c37"');
      expect(result.query).toContain('|= "\\"app_id\\":\\"abc123\\""');
    });

    it('should escape special characters in label values', async () => {
      // Labels come from runtime sources (cluster from agent URL parse) so we
      // can't trust them to be free of LogQL string-literal characters.
      const result = await buildLokiQuery(
        {},
        { ...mockConfig, lokiLabels: { ...mockConfig.lokiLabels, cluster: 'c"37\\bad' } }
      );

      expect(result.query).toContain('cluster="c\\"37\\\\bad"');
    });

    it('should build merged-streams query with job regex matcher', async () => {
      const result = await buildLokiQuery(
        { appId: 'abc123' },
        {
          lokiEndpoint: 'https://loki.example.com',
          lokiLabels: { env: 'prod', cluster: 'c37' },
          lokiJobsRegex: ['airo-agents', 'airo-preview-application', 'airo-publish-application']
        }
      );

      expect(result.query).toContain('job=~"(airo-agents|airo-preview-application|airo-publish-application)"');
      expect(result.query).toContain('cluster="c37"');
      expect(result.query).toContain('env="prod"');
      expect(result.query).toContain('|= "\\"app_id\\":\\"abc123\\""');
    });

    it('should ignore lokiLabels.job when lokiJobsRegex is set', async () => {
      const result = await buildLokiQuery(
        {},
        {
          lokiEndpoint: 'https://loki.example.com',
          lokiLabels: { job: 'airo-agents', env: 'prod' },
          lokiJobsRegex: ['airo-agents', 'airo-preview-application']
        }
      );

      expect(result.query).toContain('job=~"(airo-agents|airo-preview-application)"');
      // Must not also emit `job="airo-agents"` from lokiLabels — that would
      // produce conflicting matchers and zero results.
      expect(result.query).not.toMatch(/job="airo-agents"/);
    });

    it('should add case-sensitive line filters for search query', async () => {
      const result = await buildLokiQuery(
        { query: 'database connection' },
        mockConfig
      );

      expect(result.query).toContain('|= "database"');
      expect(result.query).toContain('|= "connection"');
    });

    it('should escape LogQL string special characters in search query', async () => {
      const result = await buildLokiQuery(
        { query: 'test"value\\path' },
        mockConfig
      );

      // Should escape quotes and backslashes for LogQL string context
      expect(result.query).toContain('|= "test\\"value\\\\path"');
    });

    it('should combine all filters correctly', async () => {
      const result = await buildLokiQuery(
        {
          levelFilter: 'error',
          appId: 'abc123',
          query: 'database'
        },
        mockConfig
      );

      // mockConfig has no cluster in lokiLabels.
      expect(result.query).not.toContain('cluster=');
      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error)\\""');
      expect(result.query).toContain('|= "\\"app_id\\":\\"abc123\\""');
      expect(result.query).toContain('|= "database"');
    });

    it('should convert ISO timestamps to nanoseconds', async () => {
      const result = await buildLokiQuery(
        {
          startTime: '2026-04-07T10:00:00.000Z',
          endTime: '2026-04-07T11:00:00.000Z'
        },
        mockConfig
      );

      const startMs = new Date('2026-04-07T10:00:00.000Z').getTime();
      const endMs = new Date('2026-04-07T11:00:00.000Z').getTime();

      expect(result.start).toBe((startMs * 1000000).toString());
      expect(result.end).toBe((endMs * 1000000).toString());
    });

    it('should use default time range when not specified', async () => {
      const result = await buildLokiQuery({}, mockConfig);

      expect(result.start).toMatch(/^\d+$/); // Should be a number string
      expect(result.end).toMatch(/^\d+$/);
      expect(parseInt(result.end)).toBeGreaterThan(parseInt(result.start));
    });

    it('should honor caller-specified size', async () => {
      const result = await buildLokiQuery(
        { size: 50 },
        mockConfig
      );

      expect(result.limit).toBe(50);
    });

    it('should default to MAX_LOKI_FETCH (500) when size is omitted', async () => {
      const result = await buildLokiQuery({}, mockConfig);

      expect(result.limit).toBe(500);
    });

    it('should handle empty config labels gracefully', async () => {
      const result = await buildLokiQuery({}, {
        lokiEndpoint: 'https://loki.example.com',
        lokiLabels: {}
      });

      expect(result.query).toBe('{}');
    });

    it('should prioritize levelsFilter over levelFilter', async () => {
      const result = await buildLokiQuery(
        {
          levelFilter: 'info',
          levelsFilter: 'error,warn'
        },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error|warn)\\""');
      expect(result.query).not.toContain('(info)');
    });

    it('should skip level filter when set to "all"', async () => {
      const result = await buildLokiQuery(
        { levelFilter: 'all' },
        mockConfig
      );

      expect(result.query).not.toContain('level\\":');
    });

    it('should detect level filters from query parameter', async () => {
      const result = await buildLokiQuery(
        { query: 'error database' },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error)\\""');
      expect(result.query).toContain('|= "database"');
      expect(result.query).not.toContain('|= "error"');
    });

    it('should detect multiple level filters from query parameter', async () => {
      const result = await buildLokiQuery(
        { query: 'error warn database' },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error|warn)\\""');
      expect(result.query).toContain('|= "database"');
      expect(result.query).not.toContain('|= "error"');
      expect(result.query).not.toContain('|= "warn"');
    });

    it('should prioritize explicit level params over query detection', async () => {
      const result = await buildLokiQuery(
        {
          levelFilter: 'info',
          query: 'error warn'
        },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(info)\\""');
      expect(result.query).not.toContain('error');
      expect(result.query).not.toContain('warn');
    });

    it('should emit case-insensitive regex so uppercase container-log levels match', async () => {
      // Preview/publish containers emit "level":"ERROR"; agents emit
      // "level":"error". Must not regress to exact-case `|=` matching.
      const result = await buildLokiQuery({ levelFilter: 'error' }, mockConfig);

      expect(result.query).toContain('|~ "(?i)');
      expect(result.query).not.toMatch(/\|= "level\\":/);
    });

    it('should anchor level regex to the exact key, not substrings like detected_level', async () => {
      // The emitted LogQL pattern (`[{,]"level":"(error)"`) must match the
      // exact `level` key at the top of a JSON object or after a comma, and
      // must NOT match look-alike keys like `detected_level`.
      const result = await buildLokiQuery({ levelFilter: 'error' }, mockConfig);

      expect(result.query).toContain('[{,]\\"level\\":\\"(error)\\"');

      // Mirror the LogQL pattern with JS RegExp semantics (`i` flag replaces
      // the Go `(?i)` inline flag).
      const re = /[{,]"level":"(error)"/i;

      expect(re.test('{"level":"error","msg":"x"}')).toBe(true);
      expect(re.test('{"level":"ERROR","msg":"x"}')).toBe(true);
      expect(re.test('{"a":1,"level":"Error"}')).toBe(true);
      expect(re.test('{"detected_level":"error","msg":"x"}')).toBe(false);
      expect(re.test('{"parent_level":"error"}')).toBe(false);
      expect(re.test('{"prev_level":"error"}')).toBe(false);
    });

    it('should drop unknown level values passed via levelFilter', async () => {
      // URL params flow into a `|~` regex; `escapeLogQLString` only handles
      // string-literal escapes, not regex metacharacters. Unknown/invalid
      // levels must be dropped so e.g. `?level=error|.*` cannot widen the
      // filter into a wildcard.
      const result = await buildLokiQuery(
        { levelFilter: 'error|.*' },
        mockConfig
      );

      expect(result.query).not.toContain('|~');
      expect(result.query).not.toContain('.*');
    });

    it('should keep only known levels from levelsFilter and drop the rest', async () => {
      const result = await buildLokiQuery(
        { levelsFilter: 'error,bogus,warn,.*' },
        mockConfig
      );

      expect(result.query).toContain('|~ "(?i)[{,]\\"level\\":\\"(error|warn)\\""');
      expect(result.query).not.toContain('bogus');
      expect(result.query).not.toContain('.*');
    });
  });

  describe('transformLokiResponse', () => {
    const mockFieldMapping: FieldMapping = {
      appIdField: 'app_id',
      appIdQueryType: 'term',
      timestampField: '@timestamp',
      levelField: 'level',
      levelKeywordField: 'level',
      messageField: 'message',
      eventField: 'event',
      eventKeywordField: 'event.keyword',
      serviceField: 'service',
      serviceKeywordField: 'service.keyword',
      displayFields: []
    };

    it('should transform basic Loki response', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {
                job: 'airo-agents',
                env: 'prod',
                detected_level: 'info'
              },
              values: [
                ['1712484000000000000', '{"level":"info","message":"Test message","app_id":"abc123"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('info');
      expect(result[0].message).toBe('Test message');
      expect(result[0].appId).toBe('abc123');
      expect(result[0].sourceId).toBe('airo-agents');
    });

    it('should parse JSON log lines', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { job: 'airo-agents' },
              values: [
                [
                  '1712484000000000000',
                  JSON.stringify({
                    level: 'error',
                    message: 'Database connection failed',
                    app_id: 'xyz789',
                    service: 'api-server',
                    hostname: 'server-01'
                  })
                ]
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].level).toBe('error');
      expect(result[0].message).toBe('Database connection failed');
      expect(result[0].appId).toBe('xyz789');
      expect(result[0].service).toBe('api-server');
      expect(result[0].hostname).toBe('server-01');
    });

    it('should handle non-JSON plain text logs', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { detected_level: 'warn' },
              values: [
                ['1712484000000000000', 'Plain text log message']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].level).toBe('warn'); // from stream label
      expect(result[0].message).toBe('Plain text log message');
    });

    it('should prefer stream labels over parsed JSON fields', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {
                detected_level: 'error',
                service_name: 'stream-service',
                env: 'prod',
                region: 'us-west-2'
              },
              values: [
                [
                  '1712484000000000000',
                  JSON.stringify({
                    level: 'info', // Should be overridden by stream label
                    message: 'Test',
                    service: 'json-service'
                  })
                ]
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].level).toBe('error'); // from stream label, not JSON
      expect(result[0].service).toBe('stream-service'); // from stream label
      expect(result[0].environment).toBe('prod');
      expect(result[0].region).toBe('us-west-2');
    });

    it('should convert nanosecond timestamps to ISO strings', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                ['1712484000000000000', '{"message":"Test"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should generate unique IDs from timestamp and log content', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                ['1712484000000000000', '{"message":"Test 1"}'],
                ['1712484000000000001', '{"message":"Test 2"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].id).not.toBe(result[1].id);
      expect(result[0].id).toContain('1712484000000000000');
      expect(result[1].id).toContain('1712484000000000001');
    });

    it('should sort logs by timestamp descending (most recent first)', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                ['1712484000000000000', '{"message":"Older"}'],
                ['1712484002000000000', '{"message":"Newer"}'],
                ['1712484001000000000', '{"message":"Middle"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].message).toBe('Newer');
      expect(result[1].message).toBe('Middle');
      expect(result[2].message).toBe('Older');
    });

    it('should handle multiple streams', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { service_name: 'service-1' },
              values: [
                ['1712484000000000000', '{"message":"From service 1"}']
              ]
            },
            {
              stream: { service_name: 'service-2' },
              values: [
                ['1712484001000000000', '{"message":"From service 2"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result).toHaveLength(2);
      expect(result[0].message).toBe('From service 2'); // More recent
      expect(result[1].message).toBe('From service 1');
    });

    it('should lowercase level values', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                ['1712484000000000000', '{"level":"ERROR","message":"Test"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].level).toBe('error');
    });

    it('should default to "unknown" level when missing', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                ['1712484000000000000', '{"message":"No level"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].level).toBe('unknown');
    });

    it('should include raw log data', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { job: 'test', env: 'dev' },
              values: [
                ['1712484000000000000', '{"level":"info","message":"Test","custom":"value"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].raw).toEqual(expect.objectContaining({
        job: 'test',
        env: 'dev',
        level: 'info',
        message: 'Test',
        custom: 'value',
        '@timestamp': expect.any(String),
        _loki_timestamp_ns: '1712484000000000000'
      }));
    });

    it('should handle empty result', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: []
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result).toEqual([]);
    });

    it('should skip malformed log entries without throwing', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                ['invalid-timestamp', '{"message":"Should be skipped"}'],
                ['1712484000000000000', '{"message":"Valid entry"}']
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      // Should only include the valid entry
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Valid entry');
    });

    it('should resolve sourceId per stream via function', () => {
      // Merged-streams mode returns logs from multiple `job` labels in one
      // response — the resolver picks the per-log sourceId from stream labels.
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { job: 'airo-agents' },
              values: [['1712484000000000000', '{"message":"agent log"}']]
            },
            {
              stream: { job: 'airo-preview-application' },
              values: [['1712484001000000000', '{"message":"preview log"}']]
            }
          ]
        }
      };

      const jobToSourceId: Record<string, string> = {
        'airo-agents': 'airo-agents',
        'airo-preview-application': 'airo-preview',
      };

      const result = transformLokiResponse(
        lokiResponse,
        mockFieldMapping,
        (labels) => jobToSourceId[labels.job] || 'unknown'
      );

      expect(result).toHaveLength(2);
      const bySource = new Map(result.map(r => [r.message, r.sourceId]));
      expect(bySource.get('agent log')).toBe('airo-agents');
      expect(bySource.get('preview log')).toBe('airo-preview');
    });

    it('should extract data field as object', () => {
      const lokiResponse: LokiQueryResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {},
              values: [
                [
                  '1712484000000000000',
                  JSON.stringify({
                    message: 'Test',
                    data: {
                      userId: '123',
                      action: 'login'
                    }
                  })
                ]
              ]
            }
          ]
        }
      };

      const result = transformLokiResponse(lokiResponse, mockFieldMapping, 'airo-agents');

      expect(result[0].data).toEqual({
        userId: '123',
        action: 'login'
      });
    });
  });
});
