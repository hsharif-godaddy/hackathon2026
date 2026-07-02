import { describe, it, expect, vi } from 'vitest';
import { buildAgentsApmAggQuery, mapAgentsApmResponse, collectAgentsApm } from './agents-apm-collector.js';

describe('buildAgentsApmAggQuery', () => {
  it('filters by service.name=airo-agents and timestamp range', () => {
    const body = buildAgentsApmAggQuery('2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z');
    const json = JSON.stringify(body);
    expect(json).toContain('airo-agents');
    expect(json).toContain('2024-01-01T00:00:00Z');
    expect(json).toContain('2024-01-01T01:00:00Z');
  });

  it('includes request, messaging, and publish filter aggs', () => {
    const body = buildAgentsApmAggQuery('start', 'end');
    const json = JSON.stringify(body);
    expect(json).toContain('"request"');
    expect(json).toContain('"messaging"');
    expect(json).toContain('"publish"');
  });
});

describe('mapAgentsApmResponse', () => {
  it('emits zeros and warns when aggregations block absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = mapAgentsApmResponse({});
    expect(result.agents_http_throughput).toBe(0);
    expect(result.agents_http_error_rate).toBe(0);
    expect(result.agents_http_p95_ms).toBe(0);
    expect(result.agents_chat_throughput).toBe(0);
    expect(result.agents_chat_p95_ms).toBe(0);
    expect(result.agents_publish_count).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('aggregations_missing'));
    warn.mockRestore();
  });

  it('converts microsecond latency to milliseconds and computes error rate', () => {
    const resp = {
      aggregations: {
        request: {
          throughput: { value: 1000 },
          success: { value: 950 },
          latency: { values: { '95.0': 500_000 } }, // 500ms in µs
        },
        messaging: {
          throughput: { value: 500 },
          latency: { values: { '95.0': 10_000_000 } }, // 10s in µs
        },
        publish: { throughput: { value: 5 } },
      },
    };
    const result = mapAgentsApmResponse(resp);
    expect(result.agents_http_throughput).toBe(1000);
    expect(result.agents_http_p95_ms).toBe(500);
    expect(result.agents_http_error_rate).toBeCloseTo(0.05, 5);
    expect(result.agents_chat_throughput).toBe(500);
    expect(result.agents_chat_p95_ms).toBe(10_000);
    expect(result.agents_publish_count).toBe(5);
  });

  it('sets error_rate to 0 when throughput is 0 (no division by zero)', () => {
    const resp = {
      aggregations: {
        request: { throughput: { value: 0 }, success: { value: 0 }, latency: { values: {} } },
        messaging: { throughput: { value: 0 }, latency: { values: {} } },
        publish: { throughput: { value: 0 } },
      },
    };
    expect(mapAgentsApmResponse(resp).agents_http_error_rate).toBe(0);
  });

  it('caps error_rate at 0 (no negative rates from success > throughput)', () => {
    const resp = {
      aggregations: {
        request: { throughput: { value: 100 }, success: { value: 110 }, latency: { values: {} } },
        messaging: { throughput: { value: 0 }, latency: { values: {} } },
        publish: { throughput: { value: 0 } },
      },
    };
    expect(mapAgentsApmResponse(resp).agents_http_error_rate).toBe(0);
  });
});

describe('collectAgentsApm (ES response seam)', () => {
  it('passes query to client.search and maps the response', async () => {
    const mockResp = {
      aggregations: {
        request: { throughput: { value: 200 }, success: { value: 190 }, latency: { values: { '95.0': 300_000 } } },
        messaging: { throughput: { value: 10 }, latency: { values: { '95.0': 5_000_000 } } },
        publish: { throughput: { value: 1 } },
      },
    };
    const search = vi.fn().mockResolvedValue(mockResp);
    const result = await collectAgentsApm({ search } as never, 'apm-index', 'start', 'end');
    expect(search).toHaveBeenCalledOnce();
    expect(result.agents_http_throughput).toBe(200);
    expect(result.agents_http_p95_ms).toBe(300);
    expect(result.agents_chat_p95_ms).toBe(5_000);
  });
});
