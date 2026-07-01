import { describe, it, expect, vi } from 'vitest';
import { robustZ, classify, detect, detectSeries, loadBaselines, loadRecentRows } from './detector.js';
import { emptyStatData } from './types.js';

const blankDoc = (data = emptyStatData()) => ({
  '@timestamp': '',
  window: '1h' as const,
  data,
  error_event_names: [],
  notes: '',
});

describe('robustZ', () => {
  it('returns 0 when mad is 0', () => {
    expect(robustZ(100, { median: 10, mad: 0 })).toBe(0);
  });
  it('scales deviation by MAD', () => {
    expect(robustZ(20, { median: 10, mad: 5 })).toBeCloseTo(0.6745 * (10 / 5), 4);
  });
});

describe('classify', () => {
  it('flags z above 6 as P1', () => { expect(classify(7)).toBe('P1'); });
  it('returns null below the noise floor', () => { expect(classify(1.5)).toBeNull(); });
  it('classifies the P1/P2/P3 boundaries (>=6 / >=4 / >=3)', () => {
    expect(classify(6)).toBe('P1');
    expect(classify(4)).toBe('P2');
    expect(classify(3)).toBe('P3');
    expect(classify(2.99)).toBeNull();
  });
});

describe('detect', () => {
  it('returns a candidate when error_rate breaches its threshold', () => {
    const today = { ...emptyStatData(), error_rate: 0.08 };
    const baselines = { error_rate: { median: 0.01, mad: 0.005 } };
    expect(detect(today, baselines).some((c) => c.stat === 'error_rate')).toBe(true);
  });
  it('does not flag context-only stats like log_count via upward MAD', () => {
    const today = { ...emptyStatData(), log_count: 1_000_000 };
    const baselines = { log_count: { median: 1000, mad: 50 } };
    // log_count is LOWER_IS_BAD — upward spike should NOT flag
    expect(detect(today, baselines).some((c) => c.stat === 'log_count')).toBe(false);
  });
  it('does not flag error_count even at high z (context-only)', () => {
    const today = { ...emptyStatData(), error_count: 1_000_000 };
    const baselines = { error_count: { median: 100, mad: 10 } };
    expect(detect(today, baselines).some((c) => c.stat === 'error_count')).toBe(false);
  });
  it('does not flag downward deviations for higher-is-worse stats', () => {
    const today = { ...emptyStatData(), error_rate: 0.001 };
    const baselines = { error_rate: { median: 0.05, mad: 0.005 } };
    expect(detect(today, baselines)).toHaveLength(0);
  });
  it('flags a spike on a normally-zero metric via the MAD floor (mad===0)', () => {
    const today = { ...emptyStatData(), error_event_count: 90 };
    const baselines = { error_event_count: { median: 0, mad: 0 } };
    const c = detect(today, baselines).find((x) => x.stat === 'error_event_count');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('P1');
  });
  it('does NOT flag a sub-floor blip on a normally-zero metric', () => {
    const today = { ...emptyStatData(), error_event_count: 5 };
    const baselines = { error_event_count: { median: 0, mad: 0 } };
    expect(detect(today, baselines).some((c) => c.stat === 'error_event_count')).toBe(false);
  });

  // ── Directional detection: lower-is-bad stats ─────────────────────────────
  it('flags log_count collapse (lower-is-bad: observed << median)', () => {
    const today = { ...emptyStatData(), log_count: 10 };
    const baselines = { log_count: { median: 50000, mad: 2000 } };
    const c = detect(today, baselines).find((x) => x.stat === 'log_count');
    expect(c).toBeDefined();
    expect(c?.severity).toBeTruthy();
  });
  it('does NOT flag log_count spike (lower-is-bad: upward not flagged)', () => {
    const today = { ...emptyStatData(), log_count: 500000 };
    const baselines = { log_count: { median: 50000, mad: 2000 } };
    expect(detect(today, baselines).some((c) => c.stat === 'log_count')).toBe(false);
  });
  it('flags req_throughput collapse (lower-is-bad)', () => {
    const today = { ...emptyStatData(), req_throughput: 5 };
    const baselines = { req_throughput: { median: 5000, mad: 200 } };
    expect(detect(today, baselines).some((c) => c.stat === 'req_throughput')).toBe(true);
  });
  it('flags publish_success_rate drop when there was real activity', () => {
    const today = { ...emptyStatData(), publish_success: 3, publish_failure: 7, publish_success_rate: 0.3 };
    const baselines = { publish_success_rate: { median: 0.95, mad: 0.02 } };
    expect(detect(today, baselines).some((c) => c.stat === 'publish_success_rate')).toBe(true);
  });
  it('does NOT flag publish_success_rate=0 when no publish activity (pre-schema row or quiet hour)', () => {
    // publish_success=0 + publish_failure=0 → rate is meaningless, not a collapse
    const today = { ...emptyStatData(), publish_success_rate: 0 };
    const baselines = { publish_success_rate: { median: 0.95, mad: 0.02 } };
    expect(detect(today, baselines).some((c) => c.stat === 'publish_success_rate')).toBe(false);
  });

  // ── Threshold detection: new_error_fingerprints ───────────────────────────
  it('flags new_error_fingerprints >= 1 as P2 regardless of baseline', () => {
    const today = { ...emptyStatData(), new_error_fingerprints: 1 };
    const c = detect(today, {}).find((x) => x.stat === 'new_error_fingerprints');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('P2');
  });
  it('does NOT flag new_error_fingerprints = 0', () => {
    expect(detect(emptyStatData(), {}).some((c) => c.stat === 'new_error_fingerprints')).toBe(false);
  });
});

describe('detectSeries', () => {
  it('keeps the worst (highest robustZ) candidate per stat across rows', () => {
    const baselines = { error_rate: { median: 0.01, mad: 0.005 } };
    const rowLow = blankDoc({ ...emptyStatData(), error_rate: 0.04 });
    const rowHigh = blankDoc({ ...emptyStatData(), error_rate: 0.08 });
    const candidates = detectSeries([rowLow, rowHigh], baselines);
    expect(candidates.length).toBe(1);
    expect(candidates[0].stat).toBe('error_rate');
    expect(candidates[0].observed).toBe(0.08);
  });
  it('returns empty array when no row triggers a candidate', () => {
    const baselines = { error_rate: { median: 0.01, mad: 0.005 } };
    const rowOk = blankDoc({ ...emptyStatData(), error_rate: 0.01 });
    expect(detectSeries([rowOk], baselines)).toHaveLength(0);
  });
});

// ES response-shape seam tests: the part most likely to break silently on an ES change.
describe('loadBaselines (ES response parsing)', () => {
  it('parses per-stat median (values["50.0"]) and mad (value) from the aggregations block', async () => {
    const search = vi.fn().mockResolvedValue({
      aggregations: {
        error_rate__median: { values: { '50.0': 0.012 } },
        error_rate__mad: { value: 0.004 },
      },
    });
    const baselines = await loadBaselines({ search } as never, 'watchtower_stats');
    expect(baselines.error_rate).toEqual({ median: 0.012, mad: 0.004 });
    expect(baselines.log_count).toEqual({ median: 0, mad: 0 });
    const body = (search.mock.calls[0][0] as { body: { query: { bool: { filter: unknown[] } } } }).body;
    expect(JSON.stringify(body.query.bool.filter)).toContain('now-24h');
  });
});

describe('loadRecentRows (ES response parsing)', () => {
  it('maps hits._source to StatsDoc[] and drops hits missing data', async () => {
    const search = vi.fn().mockResolvedValue({
      hits: { hits: [
        { _source: { data: { ...emptyStatData(), log_count: 5 }, error_event_names: ['a.error'], window: '1h', notes: '' } },
        { _source: {} },
        { _source: { data: { ...emptyStatData(), log_count: 7 }, error_event_names: [], window: '1h', notes: '' } },
      ] },
    });
    const rows = await loadRecentRows({ search } as never, 'watchtower_stats', 24);
    expect(rows.map((r) => r.data.log_count)).toEqual([5, 7]);
    expect(rows[0].error_event_names).toEqual(['a.error']);
    expect(rows[1].error_event_names).toEqual([]);
  });
  it('returns [] when the response has no hits', async () => {
    const search = vi.fn().mockResolvedValue({});
    expect(await loadRecentRows({ search } as never, 'watchtower_stats', 24)).toEqual([]);
  });
});
