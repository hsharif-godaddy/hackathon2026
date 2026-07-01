import { describe, it, expect, vi } from 'vitest';
import { buildAlbAggQuery, mapAlbResponse } from './cloudwatch-collector.js';

describe('buildAlbAggQuery', () => {
  it('filters by namespace, LoadBalancer dimension, and time range', () => {
    const q = JSON.stringify(buildAlbAggQuery(
      'app/airobuildeapptestdirectc6743dcfc/239795c4eebe32af',
      '2026-06-30T07:00:00Z',
      '2026-06-30T08:00:00Z',
    ));
    expect(q).toContain('AWS/ApplicationELB');
    expect(q).toContain('airobuildeapptestdirectc6743dcfc');
    expect(q).toContain('2026-06-30T07:00:00Z');
    expect(q).toContain('HTTPCode_Target_5XX_Count');
    expect(q).toContain('TargetResponseTime');
  });
});

describe('mapAlbResponse', () => {
  it('converts p95 from seconds to ms and returns 5xx + req counts', () => {
    const resp = {
      aggregations: {
        alb_5xx: { value: 12 },
        alb_req: { value: 5000 },
        alb_p95: { value: 3.5 }, // seconds
      },
    };
    const stats = mapAlbResponse(resp);
    expect(stats.alb_5xx_count).toBe(12);
    expect(stats.alb_req_count).toBe(5000);
    expect(stats.alb_p95_ms).toBe(3500); // 3.5s × 1000
  });

  it('returns 0 alb_p95_ms when TargetResponseTime is null (no traffic)', () => {
    const resp = {
      aggregations: {
        alb_5xx: { value: 0 },
        alb_req: { value: 0 },
        alb_p95: { value: null },
      },
    };
    expect(mapAlbResponse(resp).alb_p95_ms).toBe(0);
  });

  it('emits zeros and warns when aggregations block is absent', () => {
    const stats = mapAlbResponse({});
    expect(stats.alb_5xx_count).toBe(0);
    expect(stats.alb_req_count).toBe(0);
    expect(stats.alb_p95_ms).toBe(0);
  });

  it('exercises the ES response parsing contract (seam test)', async () => {
    const search = vi.fn().mockResolvedValue({
      aggregations: {
        alb_5xx: { value: 8 },
        alb_req: { value: 19462 },
        alb_p95: { value: 5.85 },
      },
    });
    const { collectCloudwatch } = await import('./cloudwatch-collector.js');
    const stats = await collectCloudwatch(
      { search } as never,
      'metrics-aws.cloudwatch*',
      'app/airobuildeapptestdirectc6743dcfc/239795c4eebe32af',
      '2026-06-30T07:00:00Z',
      '2026-06-30T08:00:00Z',
    );
    expect(stats.alb_5xx_count).toBe(8);
    expect(stats.alb_req_count).toBe(19462);
    expect(stats.alb_p95_ms).toBe(5850); // 5.85s × 1000
    const body = (search.mock.calls[0][0] as { body: { query: { bool: { filter: unknown[] } } } }).body;
    expect(JSON.stringify(body.query.bool.filter)).toContain('AWS/ApplicationELB');
  });
});
