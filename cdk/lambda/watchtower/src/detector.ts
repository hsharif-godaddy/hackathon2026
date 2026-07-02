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
  /** Present only on trend candidates — undefined on z-score candidates */
  trend_streak?: number;
  /** Daily values for the streak window, oldest-first. Only on trend candidates. */
  trend_values?: number[];
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
  // Agents context-only: raw counts that inform the LLM but are too coarse to flag directly
  'agents_publish_count',
  'agents_invocation_count',
  'agents_toolcall_count',
  // APM p95 latencies are context-only for hourly detection: a single slow request
  // in one APM 1-minute bucket inflates the hourly p95 unpredictably (e.g. one
  // 22-min request → p95=1368182ms → z=1845 from a zero-baseline). The daily digest
  // already runs fresh 24h queries for these and shows accurate values to the LLM.
  'agents_http_p95_ms',
  'agents_chat_p95_ms',
  // Loki: 401s dominated by bots/crawlers — high volume but not actionable
  'preview_http_401_count',
  // Source F (ESSP dev-private only): always 0 in prod — never flag as collapse
  'agents_ai_call_count',
]);

// Stats where a downward anomaly (observed < median) is the signal of interest.
// The default detect() only flags upward deviations; these are checked inverted.
const LOWER_IS_BAD = new Set<keyof StatData>([
  'log_count',       // traffic collapse (app down / upstream broken)
  'req_throughput',  // APM traffic collapse (app/ BFF)
  'publish_success_rate',
  'create_success_rate',
  'agents_http_throughput',  // agents HTTP traffic collapse
  'agents_chat_throughput',  // AI chat session collapse (nobody chatting = nothing working)
  'agent_run_count',         // no agent runs = platform idle or broken
]);

// For rate stats and cross-source stats, a value of 0 can mean "no events"
// (not a collapse) or "collector failed" (false P1). Disambiguate via a same-
// source denominator: skip detection when the denominator is 0.
//
// Denominator selection rules:
//   - publish/create success rates: use same-row attempt counts (same source, same row).
//   - agents_http/chat_throughput: gated on req_throughput (same APM source; if the
//     BFF APM collector also failed, the stat is meaningless either way).
//   - agent_run_count (Loki): gated on agents_http_throughput (same-service APM). If
//     agents received HTTP requests (APM) but Loki reports 0 runs, that is a real
//     signal. If agents_http_throughput=0 too, the platform is idle or both collectors
//     failed — skip rather than fire a false collapse.
const RATE_DENOMINATORS: Partial<Record<keyof StatData, (d: StatData) => number>> = {
  publish_success_rate: (d: StatData) => d.publish_success + d.publish_failure,
  create_success_rate:  (d: StatData) => d.create_success  + d.create_failure,
  agents_http_throughput: (d: StatData) => d.req_throughput,
  agents_chat_throughput: (d: StatData) => d.req_throughput,
  agent_run_count:        (d: StatData) => d.agents_http_throughput,
};

// MAD floors — set from 7-day prod baseline measurements (2026-07-02).
// Purpose: when baseline MAD=0 (new field or flat metric), use this floor
// so robustZ can still flag genuine spikes. Floors are set to approximately
// 50–100% of the observed prod MAD so early-baseline sensitivity matches
// what the real baseline will produce once it accrues. They never suppress
// real data-driven dispersion (only apply when observed MAD < floor).
const MAD_FLOOR: Partial<Record<keyof StatData, number>> = {
  // ── Source A: app/ BFF logs ────────────────────────────────────────────────
  // prod: error_rate ~0, preview_timeouts median=362 mad=72
  error_rate: 0.005,
  error_event_count: 500,
  distinct_error_events: 2,
  publish_success_rate: 0.05,
  create_success_rate: 0.05,
  preview_timeouts: 50,          // prod median=362, mad=72
  req_error_rate: 0.005,
  // ── Source B: app/ BFF APM ─────────────────────────────────────────────────
  // prod: latency_p95 median=635ms mad=38ms; sse_connect median=7281ms mad=2856ms
  latency_p95_ms: 100,
  sse_connect_p95_ms: 1500,      // prod mad=2856ms; floor < mad so real data wins
  sse_first_response_p95_ms: 500, // prod mad=461ms; floor ≈ real mad
  // ── Source C: ALB ─────────────────────────────────────────────────────────
  // prod: alb_5xx median=193 mad=92; alb_p95 median=13121ms mad=8664ms
  alb_5xx_count: 100,            // prod mad=92; floor ≈ mad
  alb_p95_ms: 3000,              // prod mad=8664ms; floor = ~1/3 mad
  // ── Traffic collapse (lower-is-bad) ───────────────────────────────────────
  // prod: log_count median=599261 mad=153693; req_throughput median=136901 mad=35613
  log_count: 20000,
  req_throughput: 10000,
  // ── Source D: agents APM ──────────────────────────────────────────────────
  // prod: agents_http median=18081 mad=4737; agents_http_p95 median=1480ms mad=496ms
  // prod: agents_chat_p95 median=203162ms mad=34079ms (AI gen time ~3.4min is normal)
  agents_http_error_rate: 0.02,  // prod 10% baseline; flag >2pp change
  agents_http_p95_ms: 500,       // inert — agents_http_p95_ms is CONTEXT_ONLY (skipped by detect())
  agents_http_throughput: 2000,  // prod median=18081, mad=4737
  agents_chat_throughput: 200,   // episodic (prod p95=1599/hr, median=0 off-peak)
  agents_chat_p95_ms: 15000,     // inert — agents_chat_p95_ms is CONTEXT_ONLY (skipped by detect())
  agents_ai_call_count: 100,
  // ── Source E: agents APM traces ───────────────────────────────────────────
  agents_invocation_failure_count: 2,
  agents_invocation_abort_count: 5,
  agents_invocation_fetch_fail_count: 2,
  agents_outbound_timeout_count: 5,
  // ── Source F: agents ESSP logs (dev-private singleton, low traffic) ───────
  agents_http_error_count: 10,
  agents_auth_failure_count: 5,
  // ── Source G: Loki (Nomad containers) ─────────────────────────────────────
  // prod: agent_run ~2112/hr; tool_fail ~401/hr; skill_fail ~71/hr
  // prod 7d Loki: agent_run median=2559 mad=774; tool_fail median=462 mad=108
  // prod 7d Loki: skill_fail median=67 mad=18; budget_exhaustion median=30 mad=6
  // prod 7d Loki: sse_error median=34 mad=12; publish_fail median=17 mad=5
  // prod: preview_5xx ~4100/hr (current incident elevated); preview_502 ~1700/hr
  agent_run_count: 200,
  tool_failure_count: 50,
  skill_activation_failure_count: 15,
  typecheck_failure_count: 20,
  budget_exhaustion_count: 5,    // prod mad=6; floor just below real mad
  sse_error_count: 5,
  agent_publish_failure_count: 3,
  preview_http_5xx_count: 300,   // prod baseline likely ~1000-2000/hr normally
  preview_http_502_count: 300,   // prod ~1700/hr (incident elevated); floor for early baseline
  publish_http_5xx_count: 5,     // very low publish traffic, any 5xx is notable
};

// Stats where any non-zero value is an actionable finding regardless of the
// baseline distribution (e.g. a novel error fingerprint that has never occurred).
const THRESHOLD_STATS: Partial<Record<keyof StatData, { threshold: number; severity: 'P1' | 'P2' | 'P3' }>> = {
  new_error_fingerprints: { threshold: 1, severity: 'P2' },
  agents_embedding_error_count: { threshold: 1, severity: 'P3' },
  // preview_http_502_count: container unreachable — even a few hundred/hr warrants P2.
  // Not a threshold stat (threshold would fire every hour in prod at ~1795/hr baseline).
  // Handled by MAD floor + higher-is-bad detection instead.
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
      agent_tool_names: h._source.agent_tool_names ?? [],
      failed_skill_names: h._source.failed_skill_names ?? [],
      top_tool_names: h._source.top_tool_names ?? [],
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

// Stats to check for day-over-day escalating/collapsing trends.
// When the baseline window is contaminated by an ongoing incident (z-score
// looks normal because the baseline has already absorbed the elevated values),
// a monotonic trend over 3+ consecutive daily aggregates still fires.
const TREND_HIGHER_IS_BAD: (keyof StatData)[] = [
  'alb_5xx_count',
  'req_error_rate',
  'error_rate',
  'agents_invocation_failure_count',
  'tool_failure_count',
  'preview_http_5xx_count',
  'preview_http_502_count',
  'publish_failure',
];
const TREND_LOWER_IS_BAD: (keyof StatData)[] = [
  'publish_success_rate',
  'create_success_rate',
  'req_throughput',
  'log_count',
];

// Rate stats in TREND_LOWER_IS_BAD need an activity guard: if the latest
// daily aggregate had zero attempts (create_success + create_failure = 0),
// the rate is 0 due to no traffic, not a genuine collapse.
const TREND_RATE_DENOMINATORS: Partial<Record<keyof StatData, (d: StatData) => number>> = {
  publish_success_rate: (d: StatData) => d.publish_success + d.publish_failure,
  create_success_rate:  (d: StatData) => d.create_success  + d.create_failure,
};

// Fractional stats have values in [0,1]. The relative-delta formula would floor
// the base to 1 (via Math.max(startVal, 1)) for any such stat, converting the
// intended 15% relative guard into a flat 0.15 absolute guard — silently
// suppressing real slow declines like 0.90→0.82→0.80 (Δ=0.10, 11% relative).
// These stats are already noise-gated by TREND_RATE_DENOMINATORS (zero-activity
// guard) and the streak requirement, so they are exempt from the magnitude guard.
const TREND_FRACTIONAL_STATS = new Set<keyof StatData>([
  'publish_success_rate',
  'create_success_rate',
  'req_error_rate',
  'error_rate',
]);

// Minimum total relative change required across the full streak.
// Prevents micro-drifts (e.g. 10001→10000→9999, Δ=0.02%) from triggering P3+.
// Not applied to TREND_FRACTIONAL_STATS (see above).
const TREND_MIN_RELATIVE_DELTA = 0.15;

/** Load the last N daily (window=24h) stat aggregates, oldest-first. */
export async function loadRecentDailyStats(
  client: Client,
  statsIndex: string,
  days: number,
): Promise<StatData[]> {
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
    (resp as unknown as { hits?: { hits?: { _source?: Partial<StatsDoc> }[] } }).hits?.hits ?? [];
  return hits
    .filter((h): h is { _source: Partial<StatsDoc> & { data: StatsDoc['data'] } } =>
      Boolean(h._source?.data))
    .map((h) => ({ ...emptyStatData(), ...h._source.data }));
}

/**
 * Detect monotonic escalation/collapse trends across daily stat aggregates.
 * Complements MAD z-score detection: catches ongoing incidents where the
 * 7-day baseline is already contaminated (no z-score anomaly, but values keep
 * getting worse day after day).
 */
export function detectTrends(dailyStats: StatData[]): Candidate[] {
  if (dailyStats.length < 3) return [];
  const out: Candidate[] = [];

  const check = (stat: keyof StatData, higherIsBad: boolean): void => {
    const values: number[] = dailyStats.map((d) => d[stat] as number);
    let streak = 0;
    for (let i = values.length - 1; i > 0; i--) {
      const worse = higherIsBad ? values[i] > values[i - 1] : values[i] < values[i - 1];
      if (worse) streak++;
      else break;
    }
    // streak = number of consecutive worsening transitions; days = streak + 1.
    // Require at least 3 consecutive days (streak >= 2).
    if (streak < 2) return;
    const trendValues: number[] = values.slice(-(streak + 1));
    // Skip all-zero trends: stat not yet collected or always absent
    if (trendValues.every((v) => v === 0)) return;
    // Rate stats: suppress when the latest daily aggregate had no activity.
    // A rate of 0 with 0 attempts means no traffic, not a collapse.
    const getDenom = TREND_RATE_DENOMINATORS[stat];
    if (getDenom && getDenom(dailyStats[dailyStats.length - 1]) === 0) return;
    // Magnitude guard: suppress micro-drifts below 15% total relative change.
    // Exempt fractional stats ([0,1] rates): Math.max(startVal, 1) would floor the
    // base to 1, turning "15% relative" into a flat 0.15 absolute threshold and
    // silently suppressing real slow declines (e.g. 0.90→0.82→0.80, Δ=0.10).
    if (!TREND_FRACTIONAL_STATS.has(stat)) {
      const relativeDelta = Math.abs(trendValues[trendValues.length - 1] - trendValues[0])
        / Math.max(Math.abs(trendValues[0]), 1);
      if (relativeDelta < TREND_MIN_RELATIVE_DELTA) return;
    }
    // severity based on number of days: 5+ → P1, 4 → P2, 3 → P3
    const days = streak + 1;
    const severity: Candidate['severity'] = days >= 5 ? 'P1' : days >= 4 ? 'P2' : 'P3';
    out.push({
      stat,
      observed: values[values.length - 1],
      median: values[values.length - 1 - streak],
      robustZ: 0,
      severity,
      trend_streak: days, // number of calendar days in the trend (more intuitive for display)
      trend_values: trendValues,
    });
  };

  for (const stat of TREND_HIGHER_IS_BAD) check(stat, true);
  for (const stat of TREND_LOWER_IS_BAD) check(stat, false);
  return out;
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
