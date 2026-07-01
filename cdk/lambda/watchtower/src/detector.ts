import type { Client } from '@elastic/elasticsearch';
import { STAT_KEYS, emptyStatData, type StatData, type StatsDoc } from './types.js';

export interface Baseline {
  median: number;
  mad: number;
}
export interface Candidate {
  stat: keyof StatData;
  observed: number;
  median: number;
  robustZ: number;
  severity: 'P1' | 'P2' | 'P3';
}

export type Baselines = Partial<Record<keyof StatData, Baseline>>;

const P1_Z = 6;
const P2_Z = 4;
const NOISE_Z = 3;

// Stats that are purely context for the human reader; the MAD detector never
// flags them directly. Traffic-collapse candidates (log_count, req_throughput)
// are NOT here — they live in LOWER_IS_BAD and are flagged directionally.
const CONTEXT_ONLY = new Set<keyof StatData>([
  'error_count',
  'warn_count',
  'sse_connected_count',
  'sse_first_response_count',
  'publish_success',
  'publish_failure',
  'create_success',
  'create_failure',
  'latency_p50_ms',
  'alb_req_count',
]);

// Stats where a downward anomaly (observed < median) is the signal of interest.
// The default detect() only flags upward deviations; these are checked inverted.
const LOWER_IS_BAD = new Set<keyof StatData>([
  'log_count',       // traffic collapse (app down / upstream broken)
  'req_throughput',  // APM traffic collapse
  'publish_success_rate',
  'create_success_rate',
]);

// For rate stats, a value of 0 can mean "no events in this hour" (not a collapse)
// or "all attempts failed" (real P1). Disambiguate by checking the denominator:
// if total activity is 0 the rate is meaningless — skip detection. This prevents
// pre-schema rows (defaulted to 0 via emptyStatData) from generating false
// collapse candidates while still catching real failures where activity > 0.
const RATE_DENOMINATORS: Partial<Record<keyof StatData, (d: StatData) => number>> = {
  publish_success_rate: (d: StatData) => d.publish_success + d.publish_failure,
  create_success_rate:  (d: StatData) => d.create_success  + d.create_failure,
};

// Minimum dispersion (MAD floor) per flagged stat. Without it, a metric that is
// normally 0 has mad === 0, so robustZ returns 0 and a genuine spike (e.g.
// errors appearing where there were none) would never be flagged. The floor is
// the smallest change considered meaningful for that stat; it applies only when
// the observed MAD is smaller, so it never suppresses real data-driven
// dispersion. Conservative defaults — tune with accrued data.
const MAD_FLOOR: Partial<Record<keyof StatData, number>> = {
  error_rate: 0.01,                // 1 percentage point
  error_event_count: 10,
  distinct_error_events: 2,
  sse_connect_p95_ms: 500,
  sse_first_response_p95_ms: 1000,
  publish_success_rate: 0.05,      // 5 percentage points
  create_success_rate: 0.05,
  preview_timeouts: 5,
  req_error_rate: 0.01,
  latency_p95_ms: 500,
  alb_5xx_count: 5,
  alb_p95_ms: 200,
  // Traffic-collapse stats need floors so a perfectly-flat baseline (mad=0)
  // still detects a genuine collapse — without these, robustZ returns 0 and
  // the "app is down" signal is silently suppressed. Tune with real data.
  log_count: 5000,
  req_throughput: 500,
};

// Stats where any non-zero value is an actionable finding regardless of the
// baseline distribution (e.g. a novel error fingerprint that has never occurred).
const THRESHOLD_STATS: Partial<Record<keyof StatData, { threshold: number; severity: 'P1' | 'P2' | 'P3' }>> = {
  new_error_fingerprints: { threshold: 1, severity: 'P2' },
};

export function robustZ(observed: number, b: Baseline): number {
  if (b.mad === 0) return 0;
  return (0.6745 * (observed - b.median)) / b.mad;
}

export function classify(z: number): 'P1' | 'P2' | 'P3' | null {
  const a = Math.abs(z);
  if (a >= P1_Z) return 'P1';
  if (a >= P2_Z) return 'P2';
  if (a >= NOISE_Z) return 'P3';
  return null;
}

export function detect(today: StatData, baselines: Baselines): Candidate[] {
  const out: Candidate[] = [];

  // Threshold stats: flag unconditionally when above threshold.
  for (const [key, cfg] of Object.entries(THRESHOLD_STATS) as [keyof StatData, { threshold: number; severity: 'P1' | 'P2' | 'P3' }][]) {
    if (today[key] >= cfg.threshold) {
      out.push({
        stat: key,
        observed: today[key],
        median: 0,
        robustZ: 0,
        severity: cfg.severity,
      });
    }
  }

  // MAD z-score stats: skip context-only and threshold stats.
  for (const stat of STAT_KEYS) {
    if (CONTEXT_ONLY.has(stat)) continue;
    if (stat in THRESHOLD_STATS) continue;
    const b = baselines[stat];
    if (!b) continue;
    // Floor the MAD so a normally-flat (mad === 0) metric can still flag a
    // breakout instead of being silently ignored.
    const effMad = Math.max(b.mad, MAD_FLOOR[stat] ?? 0);
    const z = robustZ(today[stat], { median: b.median, mad: effMad });
    if (LOWER_IS_BAD.has(stat)) {
      // For rate stats: skip when there was no underlying activity — rate is
      // meaningless (no events ≠ collapse). Catches pre-schema rows (defaulted
      // to 0) and quiet hours with no publish/create traffic.
      const getDenom = RATE_DENOMINATORS[stat];
      if (getDenom && getDenom(today) === 0) continue;
      // For lower-is-bad stats, a large negative z means observed << median —
      // flag downward anomalies by inverting the sign.
      if (z >= 0) continue;
      const severity = classify(-z);
      if (!severity) continue;
      out.push({ stat, observed: today[stat], median: b.median, robustZ: -z, severity });
    } else {
      // Default: higher-is-worse — only flag upward deviations.
      if (z <= 0) continue;
      const severity = classify(z);
      if (!severity) continue;
      out.push({ stat, observed: today[stat], median: b.median, robustZ: z, severity });
    }
  }
  return out;
}

export async function loadRecentRows(
  client: Client,
  statsIndex: string,
  hours: number,
): Promise<StatsDoc[]> {
  const body: Record<string, unknown> = {
    size: hours * 2,
    sort: [{ '@timestamp': 'asc' }],
    query: {
      bool: {
        filter: [
          { term: { window: '1h' } },
          { range: { '@timestamp': { gte: `now-${hours}h`, lt: 'now' } } },
        ],
      },
    },
  };
  const resp = await client.search({ index: statsIndex, body });
  const hits =
    (resp as unknown as { hits?: { hits?: { _source?: Partial<StatsDoc> }[] } }).hits?.hits ?? [];
  // `data` is trusted: Watchtower itself wrote these rows with the fixed schema,
  // so a truthy `_source.data` is treated as a valid StatData (no shape
  // validation). The Boolean filter only drops rows missing `data` entirely.
  return hits
    .filter((h): h is { _source: Partial<StatsDoc> & { data: StatsDoc['data'] } } =>
      Boolean(h._source?.data))
    .map((h) => ({
      '@timestamp': h._source['@timestamp'] ?? '',
      window: h._source.window ?? '1h',
      // Merge with emptyStatData() so rows written before a schema expansion
      // (missing new fields) default to 0 rather than undefined → NaN in sums.
      data: { ...emptyStatData(), ...h._source.data },
      error_event_names: h._source.error_event_names ?? [],
      notes: h._source.notes ?? '',
    }));
}

/** Returns the last N daily (24h) notes written by the LLM — the rolling memory. */
export async function loadRecentDailyNotes(
  client: Client,
  statsIndex: string,
  days: number,
): Promise<string[]> {
  const body: Record<string, unknown> = {
    size: days,
    sort: [{ '@timestamp': 'asc' }],
    query: {
      bool: {
        filter: [
          { term: { window: '24h' } },
          { range: { '@timestamp': { gte: `now-${days}d`, lt: 'now' } } },
        ],
      },
    },
  };
  const resp = await client.search({ index: statsIndex, body });
  const hits =
    (resp as unknown as { hits?: { hits?: { _source?: { notes?: string } }[] } }).hits?.hits ?? [];
  return hits.map((h) => h._source?.notes ?? '').filter(Boolean);
}

/** Returns the set of all error-event names that appeared in the trailing-N-hour baseline. */
export async function loadEventNameBaseline(
  client: Client,
  statsIndex: string,
  hours: number,
): Promise<Set<string>> {
  const rows = await loadRecentRows(client, statsIndex, hours);
  const baseline = new Set<string>();
  for (const row of rows) {
    for (const name of row.error_event_names) {
      baseline.add(name);
    }
  }
  return baseline;
}

export function detectSeries(rows: StatsDoc[], baselines: Baselines): Candidate[] {
  const worst = new Map<keyof StatData, Candidate>();
  for (const row of rows) {
    for (const c of detect(row.data, baselines)) {
      const prev = worst.get(c.stat);
      if (!prev || c.robustZ > prev.robustZ) worst.set(c.stat, c);
    }
  }
  return [...worst.values()];
}

export async function loadBaselines(client: Client, statsIndex: string): Promise<Baselines> {
  const aggs: Record<string, unknown> = {};
  for (const stat of STAT_KEYS) {
    aggs[`${stat}__median`] = { percentiles: { field: `data.${stat}`, percents: [50] } };
    aggs[`${stat}__mad`] = { median_absolute_deviation: { field: `data.${stat}` } };
  }
  const body: Record<string, unknown> = {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { window: '1h' } },
          { range: { '@timestamp': { gte: 'now-7d', lt: 'now-24h' } } },
        ],
      },
    },
    aggs,
  };
  const resp = await client.search({ index: statsIndex, body });
  const a =
    (resp as unknown as {
      aggregations?: Record<string, { values?: Record<string, number>; value?: number }>;
    }).aggregations ?? {};
  const baselines: Baselines = {};
  for (const stat of STAT_KEYS) {
    const medianAgg = a[`${stat}__median`];
    const madAgg = a[`${stat}__mad`];
    // Distinguish "aggregation absent" (a renamed/dropped agg — a real problem
    // that would otherwise silently yield a 0 baseline) from "present, value 0".
    if (medianAgg === undefined || madAgg === undefined) {
      console.warn('watchtower.baseline.agg_missing stat=%s', stat);
    }
    baselines[stat] = {
      median: medianAgg?.values?.['50.0'] ?? 0,
      mad: madAgg?.value ?? 0,
    };
  }
  return baselines;
}
