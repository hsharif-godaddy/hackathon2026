import { describe, it, expect } from 'vitest';
import { buildHourlyAggQuery, mapAggResponse } from './collector.js';
import { emptyStatData } from './types.js';

describe('buildHourlyAggQuery', () => {
  it('scopes to the window, tracks total hits, and requests level/error-event/sse aggs', () => {
    const q = buildHourlyAggQuery('2026-06-26T13:00:00Z', '2026-06-26T14:00:00Z') as Record<string, unknown>;
    expect(q.size).toBe(0);
    expect(q.track_total_hits).toBe(true);
    expect((q.aggs as Record<string, unknown>).error_count).toBeDefined();
    expect(((q.aggs as Record<string, unknown>).error_events as Record<string, unknown>).aggs).toBeDefined();
  });

  it('includes golden-flow agg keys', () => {
    const q = JSON.stringify(buildHourlyAggQuery('s', 'e'));
    expect(q).toContain('publish_success');
    expect(q).toContain('publish_failure');
    expect(q).toContain('create_success');
    expect(q).toContain('create_failure');
    expect(q).toContain('preview_timeouts');
  });

  it('includes error_events names terms sub-agg for fingerprint tracking', () => {
    const q = JSON.stringify(buildHourlyAggQuery('s', 'e'));
    expect(q).toContain('"names"');
  });
});

describe('mapAggResponse', () => {
  it('derives counts, error_rate, distinct errors, and SSE p95s', () => {
    const resp = {
      hits: { total: { value: 100000 } },
      aggregations: {
        error_count: { doc_count: 1500 },
        warn_count: { doc_count: 14000 },
        error_events: { doc_count: 1200, distinct: { value: 9 }, names: { buckets: [] } },
        sse_connected: { doc_count: 1390, p95: { values: { '95.0': 240 } } },
        sse_first_response: { doc_count: 3528, p95: { values: { '95.0': 4100 } } },
        publish_success: { doc_count: 0 },
        publish_failure: { doc_count: 0 },
        create_success: { doc_count: 0 },
        create_failure: { doc_count: 0 },
        preview_timeouts: { doc_count: 0 },
      },
    };
    const { data } = mapAggResponse(resp);
    expect(data.log_count).toBe(100000);
    expect(data.error_count).toBe(1500);
    expect(data.warn_count).toBe(14000);
    expect(data.error_rate).toBeCloseTo(0.015, 6);
    expect(data.error_event_count).toBe(1200);
    expect(data.distinct_error_events).toBe(9);
    expect(data.sse_connected_count).toBe(1390);
    expect(data.sse_first_response_count).toBe(3528);
    expect(data.sse_connect_p95_ms).toBe(240);
    expect(data.sse_first_response_p95_ms).toBe(4100);
  });

  it('populates golden-flow counts and computes publish_success_rate', () => {
    const resp = {
      hits: { total: { value: 100 } },
      aggregations: {
        error_count: { doc_count: 0 },
        warn_count: { doc_count: 0 },
        error_events: { doc_count: 0, distinct: { value: 0 }, names: { buckets: [] } },
        sse_connected: { doc_count: 0 },
        sse_first_response: { doc_count: 0 },
        publish_success: { doc_count: 80 },
        publish_failure: { doc_count: 20 },
        create_success: { doc_count: 10 },
        create_failure: { doc_count: 0 },
        preview_timeouts: { doc_count: 5 },
      },
    };
    const { data } = mapAggResponse(resp);
    expect(data.publish_success).toBe(80);
    expect(data.publish_failure).toBe(20);
    expect(data.publish_success_rate).toBeCloseTo(0.8);
    expect(data.create_success_rate).toBe(1.0);
    expect(data.preview_timeouts).toBe(5);
  });

  it('sets success rates to 0 when no events in window', () => {
    const resp = {
      hits: { total: { value: 50 } },
      aggregations: {
        error_count: { doc_count: 0 },
        warn_count: { doc_count: 0 },
        error_events: { doc_count: 0, distinct: { value: 0 }, names: { buckets: [] } },
        sse_connected: { doc_count: 0 },
        sse_first_response: { doc_count: 0 },
        publish_success: { doc_count: 0 },
        publish_failure: { doc_count: 0 },
        create_success: { doc_count: 0 },
        create_failure: { doc_count: 0 },
        preview_timeouts: { doc_count: 0 },
      },
    };
    const { data } = mapAggResponse(resp);
    expect(data.publish_success_rate).toBe(0);
    expect(data.create_success_rate).toBe(0);
  });

  it('returns errorEventNames from the names terms sub-agg', () => {
    const resp = {
      hits: { total: { value: 10 } },
      aggregations: {
        error_count: { doc_count: 0 },
        warn_count: { doc_count: 0 },
        error_events: {
          doc_count: 2,
          distinct: { value: 2 },
          names: { buckets: [
            { key: 'auth.login.error', doc_count: 1 },
            { key: 'payment.charge.failed', doc_count: 1 },
          ] },
        },
        sse_connected: { doc_count: 0 },
        sse_first_response: { doc_count: 0 },
        publish_success: { doc_count: 0 },
        publish_failure: { doc_count: 0 },
        create_success: { doc_count: 0 },
        create_failure: { doc_count: 0 },
        preview_timeouts: { doc_count: 0 },
      },
    };
    const { errorEventNames } = mapAggResponse(resp);
    expect(errorEventNames).toEqual(['auth.login.error', 'payment.charge.failed']);
  });

  it('sets new_error_fingerprints to 0 (computed by caller, not collector)', () => {
    const resp = {
      hits: { total: { value: 5 } },
      aggregations: {
        error_count: { doc_count: 0 },
        warn_count: { doc_count: 0 },
        error_events: { doc_count: 0, distinct: { value: 0 }, names: { buckets: [] } },
        sse_connected: { doc_count: 0 },
        sse_first_response: { doc_count: 0 },
        publish_success: { doc_count: 0 },
        publish_failure: { doc_count: 0 },
        create_success: { doc_count: 0 },
        create_failure: { doc_count: 0 },
        preview_timeouts: { doc_count: 0 },
      },
    };
    expect(mapAggResponse(resp).data.new_error_fingerprints).toBe(0);
  });

  it('emits all-zero StatData when aggregations block is absent', () => {
    const { data, errorEventNames } = mapAggResponse({ hits: { total: { value: 0 } } });
    expect(data).toEqual(emptyStatData());
    expect(errorEventNames).toEqual([]);
  });
});
