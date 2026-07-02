import { describe, it, expect } from 'vitest';
import { aggregateDay } from './aggregate.js';
import { emptyStatData } from './types.js';

describe('aggregateDay', () => {
  it('returns all-zero StatData for empty rows', () => {
    expect(aggregateDay([])).toEqual(emptyStatData());
  });

  it('sums additive fields across rows', () => {
    const r1 = { ...emptyStatData(), log_count: 100, error_count: 5, warn_count: 10, error_event_count: 3, sse_connected_count: 20, sse_first_response_count: 15 };
    const r2 = { ...emptyStatData(), log_count: 200, error_count: 10, warn_count: 20, error_event_count: 7, sse_connected_count: 30, sse_first_response_count: 25 };
    const result = aggregateDay([r1, r2]);
    expect(result.log_count).toBe(300);
    expect(result.error_count).toBe(15);
    expect(result.warn_count).toBe(30);
    expect(result.error_event_count).toBe(10);
    expect(result.sse_connected_count).toBe(50);
    expect(result.sse_first_response_count).toBe(40);
  });

  it('takes max for distinct_error_events and p95 latencies', () => {
    const r1 = { ...emptyStatData(), distinct_error_events: 3, sse_connect_p95_ms: 100, sse_first_response_p95_ms: 200 };
    const r2 = { ...emptyStatData(), distinct_error_events: 7, sse_connect_p95_ms: 50, sse_first_response_p95_ms: 400 };
    const result = aggregateDay([r1, r2]);
    expect(result.distinct_error_events).toBe(7);
    expect(result.sse_connect_p95_ms).toBe(100);
    expect(result.sse_first_response_p95_ms).toBe(400);
  });

  it('recomputes error_rate from aggregated counts', () => {
    const r1 = { ...emptyStatData(), log_count: 100, error_count: 10 };
    const r2 = { ...emptyStatData(), log_count: 100, error_count: 20 };
    const result = aggregateDay([r1, r2]);
    expect(result.error_rate).toBeCloseTo(0.15, 5);
  });

  it('sets error_rate to 0 when log_count is 0', () => {
    const r1 = { ...emptyStatData(), error_count: 5 };
    expect(aggregateDay([r1]).error_rate).toBe(0);
  });

  it('recomputes publish_success_rate from aggregated success/failure totals', () => {
    const r1 = { ...emptyStatData(), publish_success: 80, publish_failure: 10 };
    const r2 = { ...emptyStatData(), publish_success: 70, publish_failure: 40 };
    const result = aggregateDay([r1, r2]);
    // 150 / (150 + 50) = 0.75
    expect(result.publish_success_rate).toBeCloseTo(0.75, 5);
  });

  it('sets publish_success_rate to 0 when no publish events', () => {
    expect(aggregateDay([emptyStatData()]).publish_success_rate).toBe(0);
  });

  it('sums new_error_fingerprints across hours', () => {
    const r1 = { ...emptyStatData(), new_error_fingerprints: 2 };
    const r2 = { ...emptyStatData(), new_error_fingerprints: 3 };
    expect(aggregateDay([r1, r2]).new_error_fingerprints).toBe(5);
  });

  it('sums req_throughput and alb_5xx_count', () => {
    const r1 = { ...emptyStatData(), req_throughput: 5000, alb_5xx_count: 3 };
    const r2 = { ...emptyStatData(), req_throughput: 4800, alb_5xx_count: 5 };
    const result = aggregateDay([r1, r2]);
    expect(result.req_throughput).toBe(9800);
    expect(result.alb_5xx_count).toBe(8);
  });

  it('takes max for APM and ALB p95 latencies', () => {
    const r1 = { ...emptyStatData(), latency_p95_ms: 200, alb_p95_ms: 1500 };
    const r2 = { ...emptyStatData(), latency_p95_ms: 800, alb_p95_ms: 800 };
    const result = aggregateDay([r1, r2]);
    expect(result.latency_p95_ms).toBe(800);
    expect(result.alb_p95_ms).toBe(1500);
  });

  it('computes req_error_rate as traffic-weighted average, not unweighted', () => {
    // r1: 10000 req at 10% error = 1000 errors
    // r2:  1000 req at 50% error =  500 errors
    // weighted: 1500 / 11000 ≈ 13.6% (unweighted average would be 30%)
    const r1 = { ...emptyStatData(), req_throughput: 10000, req_error_rate: 0.1 };
    const r2 = { ...emptyStatData(), req_throughput: 1000, req_error_rate: 0.5 };
    expect(aggregateDay([r1, r2]).req_error_rate).toBeCloseTo(1500 / 11000, 5);
  });

  it('excludes zero-throughput hours from req_error_rate (collector failure guard)', () => {
    const r1 = { ...emptyStatData(), req_throughput: 5000, req_error_rate: 0.1 };
    const r2 = { ...emptyStatData(), req_throughput: 0, req_error_rate: 0 };
    expect(aggregateDay([r1, r2]).req_error_rate).toBeCloseTo(0.1, 5);
  });
});
