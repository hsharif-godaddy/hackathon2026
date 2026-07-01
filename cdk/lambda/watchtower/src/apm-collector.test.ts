import { describe, it, expect, vi } from 'vitest';
import { buildApmAggQuery, mapApmResponse } from './apm-collector.js';

describe('buildApmAggQuery', () => {
  it('filters by service.name and time range', () => {
    const q = JSON.stringify(buildApmAggQuery('airo-app-builder-test', '2026-06-30T07:00:00Z', '2026-06-30T08:00:00Z'));
    expect(q).toContain('airo-app-builder-test');
    expect(q).toContain('2026-06-30T07:00:00Z');
    expect(q).toContain('transaction.duration.histogram');
    expect(q).toContain('event.success_count');
  });
});

describe('mapApmResponse', () => {
  it('computes throughput, req_error_rate, and latency ms from µs values', () => {
    const resp = {
      aggregations: {
        throughput: { value: 1000 },
        success: { value: 950 },
        latency: { values: { '50.0': 20000, '95.0': 1500000 } }, // µs → ms
      },
    };
    const stats = mapApmResponse(resp);
    expect(stats.req_throughput).toBe(1000);
    expect(stats.req_error_rate).toBeCloseTo(0.05);
    expect(stats.latency_p50_ms).toBe(20);   // 20000µs → 20ms
    expect(stats.latency_p95_ms).toBe(1500); // 1500000µs → 1500ms
  });

  it('returns zero error_rate when all requests succeed', () => {
    const resp = {
      aggregations: {
        throughput: { value: 500 },
        success: { value: 500 },
        latency: { values: { '50.0': 5000, '95.0': 50000 } },
      },
    };
    expect(mapApmResponse(resp).req_error_rate).toBe(0);
  });

  it('returns all-zero stats when throughput is 0 (no APM traffic)', () => {
    const resp = {
      aggregations: {
        throughput: { value: 0 },
        success: { value: 0 },
        latency: { values: { '50.0': null, '95.0': null } },
      },
    };
    const stats = mapApmResponse(resp);
    expect(stats.req_throughput).toBe(0);
    expect(stats.req_error_rate).toBe(0);
    expect(stats.latency_p50_ms).toBe(0);
    expect(stats.latency_p95_ms).toBe(0);
  });

  it('emits zeros and warns when aggregations block is absent', () => {
    const stats = mapApmResponse({});
    expect(stats.req_throughput).toBe(0);
    expect(stats.req_error_rate).toBe(0);
  });

  it('exercises the ES response parsing contract (seam test)', async () => {
    const search = vi.fn().mockResolvedValue({
      aggregations: {
        throughput: { value: 200 },
        success: { value: 180 },
        latency: { values: { '50.0': 10000, '95.0': 800000 } },
      },
    });
    const { collectApm } = await import('./apm-collector.js');
    const stats = await collectApm(
      { search } as never,
      'metrics-apm.service_transaction.1m*',
      'airo-app-builder-test',
      '2026-06-30T07:00:00Z',
      '2026-06-30T08:00:00Z',
    );
    expect(stats.req_throughput).toBe(200);
    expect(stats.req_error_rate).toBeCloseTo(0.1);
    expect(stats.latency_p50_ms).toBe(10);
    expect(stats.latency_p95_ms).toBe(800);
    const body = (search.mock.calls[0][0] as { body: { query: { bool: { filter: unknown[] } } } }).body;
    expect(JSON.stringify(body.query.bool.filter)).toContain('airo-app-builder-test');
  });
});
