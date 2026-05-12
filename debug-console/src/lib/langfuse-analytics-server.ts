import { getLangfuseAnalyticsConfig, traceUrl } from '@/lib/langfuse-analytics-client';

type LfRow = Record<string, unknown>;

function num(r: LfRow, k: string): number {
  const v = r[k];
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(r: LfRow, k: string): string {
  const v = r[k];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export async function lfGet(
  path: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<Record<string, unknown>> {
  const c = getLangfuseAnalyticsConfig();
  if (!c) throw new Error('Langfuse analytics credentials not configured');

  const sp = new URLSearchParams();
  if (searchParams) {
    for (const [key, val] of Object.entries(searchParams)) {
      if (val !== undefined && val !== '') sp.set(key, String(val));
    }
  }
  const qs = sp.size ? `?${sp}` : '';
  const url = `${c.baseUrl}/api/public/${path}${qs}`;
  const res = await fetch(url, {
    headers: {
      Authorization: c.authHeader,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Langfuse ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function lfMetrics(query: object): Promise<LfRow[]> {
  const c = getLangfuseAnalyticsConfig();
  if (!c) throw new Error('Langfuse analytics credentials not configured');

  const q = encodeURIComponent(JSON.stringify(query));
  const url = `${c.baseUrl}/api/public/metrics?query=${q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: c.authHeader,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Langfuse metrics: ${res.status} ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { data?: LfRow[] };
  return Array.isArray(body.data) ? body.data : [];
}

const EXCLUDE_SENTIMENT = new Set(['none', '(none)', 'null', '']);

function rowCount(r: LfRow): number {
  return num(r, 'count_count') || num(r, 'countCount');
}

function rowStringValue(r: LfRow): string {
  return str(r, 'stringValue') || str(r, 'string_value');
}

function rowName(r: LfRow): string {
  return str(r, 'name');
}

function rowTimestampDay(r: LfRow): string {
  const raw =
    str(r, 'timestampDay') ||
    str(r, 'timestamp_day') ||
    str(r, 'time') ||
    str(r, 'bucket') ||
    '';
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

const BASE_METRICS = [
  { measure: 'latency', aggregation: 'p50' },
  { measure: 'latency', aggregation: 'p90' },
  { measure: 'latency', aggregation: 'p95' },
  { measure: 'latency', aggregation: 'p99' },
  { measure: 'count', aggregation: 'count' },
];

function latencyMs(r: LfRow, p: '50' | '90' | '95' | '99'): number | null {
  const snakeKey = `p${p}_latency`;
  const camelKey = `p${p}Latency`;
  if (typeof r[snakeKey] === 'number' && !Number.isNaN(r[snakeKey] as number)) {
    return r[snakeKey] as number;
  }
  if (typeof r[camelKey] === 'number' && !Number.isNaN(r[camelKey] as number)) {
    return r[camelKey] as number;
  }
  return null;
}

export async function buildOverview(fromTs: string, toTs: string) {
  const dailyRes = await lfGet('metrics/daily', {
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  const daily = (dailyRes.data as LfRow[] | undefined) ?? [];
  let totalTraces = 0;
  let totalCost = 0;
  const modelAgg: Record<
    string,
    {
      model: string | null;
      cost: number;
      input_tokens: number;
      output_tokens: number;
      count_obs: number;
    }
  > = {};

  for (const day of daily) {
    totalTraces += num(day, 'countTraces') || num(day, 'count_traces');
    totalCost += num(day, 'totalCost') || num(day, 'total_cost');
    const usage = (day.usage as LfRow[] | undefined) ?? [];
    for (const u of usage) {
      const key = str(u, 'model') || '__untracked__';
      if (!modelAgg[key]) {
        modelAgg[key] = {
          model: str(u, 'model') || null,
          cost: 0,
          input_tokens: 0,
          output_tokens: 0,
          count_obs: 0,
        };
      }
      modelAgg[key].cost += num(u, 'totalCost') || num(u, 'total_cost');
      modelAgg[key].input_tokens += num(u, 'inputUsage') || num(u, 'input_usage');
      modelAgg[key].output_tokens += num(u, 'outputUsage') || num(u, 'output_usage');
      modelAgg[key].count_obs += num(u, 'countObservations') || num(u, 'count_observations');
    }
  }

  const model_costs = Object.values(modelAgg)
    .filter((m) => m.cost > 0 || m.model)
    .sort((a, b) => b.cost - a.cost);

  const scoreRows = await lfMetrics({
    view: 'scores-categorical',
    dimensions: [{ field: 'name' }],
    metrics: [{ measure: 'count', aggregation: 'count' }],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  const total_scores = scoreRows.reduce((s, r) => s + rowCount(r), 0);
  const score_by_name: Record<string, number> = {};
  for (const r of scoreRows) {
    const n = rowName(r);
    if (n) score_by_name[n] = rowCount(r);
  }

  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total_traces: totalTraces,
    total_cost: totalCost,
    total_scores,
    model_costs,
    score_by_name,
  };
}

export async function buildSentiment(fromTs: string, toTs: string) {
  const results: Record<string, { total: number; rows: { value: string; count: number; pct: number }[] }> = {};

  for (const scoreName of ['emotion-type', 'sentiment-polarity'] as const) {
    const raw = await lfMetrics({
      view: 'scores-categorical',
      dimensions: [{ field: 'stringValue' }],
      metrics: [{ measure: 'count', aggregation: 'count' }],
      filters: [
        { column: 'name', type: 'string', operator: '=', value: scoreName },
      ],
      fromTimestamp: fromTs,
      toTimestamp: toTs,
    });
    const rows = raw.filter((r) => !EXCLUDE_SENTIMENT.has(rowStringValue(r).toLowerCase()));
    rows.sort((a, b) => rowCount(b) - rowCount(a));
    const total = rows.reduce((s, r) => s + rowCount(r), 0);
    results[scoreName] = {
      total,
      rows: rows.map((r) => ({
        value: rowStringValue(r) || '(none)',
        count: rowCount(r),
        pct: total ? Math.round((rowCount(r) / total) * 1000) / 10 : 0,
      })),
    };
  }

  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    ...results,
  };
}

export async function buildActionIntents(fromTs: string, toTs: string) {
  const rows = await lfMetrics({
    view: 'scores-categorical',
    dimensions: [{ field: 'stringValue' }],
    metrics: [{ measure: 'count', aggregation: 'count' }],
    filters: [{ column: 'name', type: 'string', operator: '=', value: 'Action intent' }],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  rows.sort((a, b) => rowCount(b) - rowCount(a));
  const total = rows.reduce((s, r) => s + rowCount(r), 0);
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total,
    rows: rows.map((r) => ({
      intent: rowStringValue(r) || '(none)',
      count: rowCount(r),
      pct: total ? Math.round((rowCount(r) / total) * 1000) / 10 : 0,
    })),
  };
}

export async function buildVerticals(fromTs: string, toTs: string) {
  let rows = await lfMetrics({
    view: 'scores-categorical',
    dimensions: [{ field: 'stringValue' }],
    metrics: [{ measure: 'count', aggregation: 'count' }],
    filters: [{ column: 'name', type: 'string', operator: '=', value: 'Vertical' }],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  rows = rows.filter((r) => rowStringValue(r) !== 'other_vertical');
  rows.sort((a, b) => rowCount(b) - rowCount(a));
  const total = rows.reduce((s, r) => s + rowCount(r), 0);
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total,
    rows: rows.map((r) => ({
      vertical: rowStringValue(r) || '(none)',
      count: rowCount(r),
      pct: total ? Math.round((rowCount(r) / total) * 1000) / 10 : 0,
    })),
  };
}

export async function buildPerformance(fromTs: string, toTs: string) {
  const totalData = await lfMetrics({
    view: 'traces',
    dimensions: [],
    metrics: [...BASE_METRICS],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  const obsData = await lfMetrics({
    view: 'observations',
    dimensions: [{ field: 'name' }],
    metrics: [...BASE_METRICS],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });

  const totalRow = totalData[0] ?? {};

  const obs_rows = obsData
    .map((r) => ({
      name: rowName(r) || '(unnamed)',
      count: rowCount(r),
      p50_ms: latencyMs(r, '50'),
      p90_ms: latencyMs(r, '90'),
      p95_ms: latencyMs(r, '95'),
      p99_ms: latencyMs(r, '99'),
    }))
    .sort((a, b) => (b.p95_ms ?? 0) - (a.p95_ms ?? 0));

  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total: {
      count: rowCount(totalRow),
      p50_ms: latencyMs(totalRow, '50'),
      p90_ms: latencyMs(totalRow, '90'),
      p95_ms: latencyMs(totalRow, '95'),
      p99_ms: latencyMs(totalRow, '99'),
    },
    observations: obs_rows,
  };
}

export async function buildToolErrors(fromTs: string, toTs: string) {
  let rows = await lfMetrics({
    view: 'scores-categorical',
    dimensions: [{ field: 'stringValue' }],
    metrics: [{ measure: 'count', aggregation: 'count' }],
    filters: [{ column: 'name', type: 'string', operator: '=', value: 'tool-error-eval' }],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  rows = rows.filter((r) => rowStringValue(r).toLowerCase() !== 'other');
  rows.sort((a, b) => rowCount(b) - rowCount(a));
  const total = rows.reduce((s, r) => s + rowCount(r), 0);
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total,
    rows: rows.map((r) => ({
      error_type: rowStringValue(r) || '(none)',
      count: rowCount(r),
      pct: total ? Math.round((rowCount(r) / total) * 1000) / 10 : 0,
    })),
  };
}

export async function buildToolErrorsDaily(fromTs: string, toTs: string) {
  let rows = await lfMetrics({
    view: 'scores-categorical',
    dimensions: [{ field: 'timestampDay' }, { field: 'stringValue' }],
    metrics: [{ measure: 'count', aggregation: 'count' }],
    filters: [{ column: 'name', type: 'string', operator: '=', value: 'tool-error-eval' }],
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  rows = rows.filter((r) => rowStringValue(r).toLowerCase() !== 'other');
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    rows: rows
      .map((r) => ({
        day: rowTimestampDay(r),
        error_type: rowStringValue(r) || '(none)',
        count: rowCount(r),
      }))
      .filter((r) => r.day),
  };
}

export async function buildRecentErrors(fromTs: string, toTs: string) {
  if (!getLangfuseAnalyticsConfig()) {
    throw new Error('Langfuse analytics credentials not configured');
  }

  const fromMs = new Date(fromTs).getTime();
  const toMs = new Date(toTs).getTime();

  const scoresData = await lfGet('scores', {
    name: 'tool-error-eval',
    limit: 50,
    page: 1,
    fromTimestamp: fromTs,
    toTimestamp: toTs,
  });
  const scores = (scoresData.data as LfRow[] | undefined) ?? [];
  const seenTraceIds: { tid: string; error_type: string }[] = [];
  const seenSet = new Set<string>();

  function scoreInSelectedRange(row: LfRow): boolean {
    const ts = str(row, 'timestamp');
    if (!ts) return false;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return false;
    return t >= fromMs && t <= toMs;
  }

  const sorted = [...scores].filter(scoreInSelectedRange).sort(
    (a, b) => str(b, 'timestamp').localeCompare(str(a, 'timestamp')),
  );

  for (const s of sorted) {
    const val = (str(s, 'stringValue') || str(s, 'string_value')).trim();
    if (!val || val.toLowerCase() === 'other') continue;
    const tid = str(s, 'traceId') || str(s, 'trace_id');
    if (tid && !seenSet.has(tid)) {
      seenSet.add(tid);
      seenTraceIds.push({ tid, error_type: val });
    }
    if (seenTraceIds.length >= 5) break;
  }

  const error_traces: Record<string, unknown>[] = [];
  let trace_fetch_errors = 0;

  for (const { tid, error_type } of seenTraceIds) {
    try {
      const t = await lfGet(`traces/${tid}`);
      const projectId = str(t, 'projectId') || str(t, 'project_id');
      const meta = (t.metadata as Record<string, unknown> | undefined) ?? {};
      error_traces.push({
        id: str(t, 'id') || tid,
        name: str(t, 'name'),
        timestamp: str(t, 'timestamp'),
        level: str(t, 'level'),
        error_type,
        user_id: str(t, 'userId') || str(t, 'user_id'),
        session_id: str(t, 'sessionId') || str(t, 'session_id'),
        app_id: typeof meta.business_data_appId === 'string' ? meta.business_data_appId : undefined,
        latency: num(t, 'latency'),
        total_cost: num(t, 'totalCost') || num(t, 'total_cost'),
        tags: (t.tags as string[] | undefined) ?? [],
        url: traceUrl(projectId, tid),
      });
    } catch (err) {
      trace_fetch_errors += 1;
      console.error('buildRecentErrors: failed to fetch trace', tid, err);
    }
  }

  return {
    from_date: new Date(fromTs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    to_date: new Date(toTs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    traces: error_traces,
    trace_fetch_errors,
  };
}

export async function buildModel() {
  const data = await lfGet('observations', { type: 'GENERATION', limit: 1 });
  const obsList = (data.data as LfRow[] | undefined) ?? [];
  if (obsList.length === 0) return { model: null, trace_id: null };

  const obs = obsList[0];
  let model = str(obs, 'model') || null;
  const traceId = str(obs, 'traceId') || str(obs, 'trace_id') || null;
  if (!model) {
    const name = str(obs, 'name');
    const m = /\(([^)]+)\)/.exec(name);
    if (m) model = m[1];
  }
  return { model, trace_id: traceId };
}

export function emptyLangfuseOverview(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildOverview>> {
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total_traces: 0,
    total_cost: 0,
    total_scores: 0,
    model_costs: [],
    score_by_name: {},
  };
}

export function emptyLangfuseSentiment(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildSentiment>> {
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    'emotion-type': { total: 0, rows: [] },
    'sentiment-polarity': { total: 0, rows: [] },
  } as Awaited<ReturnType<typeof buildSentiment>>;
}

export function emptyLangfuseActionIntents(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildActionIntents>> {
  return { from_date: fromTs.slice(0, 10), to_date: toTs.slice(0, 10), total: 0, rows: [] };
}

export function emptyLangfuseVerticals(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildVerticals>> {
  return { from_date: fromTs.slice(0, 10), to_date: toTs.slice(0, 10), total: 0, rows: [] };
}

export function emptyLangfusePerformance(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildPerformance>> {
  return {
    from_date: fromTs.slice(0, 10),
    to_date: toTs.slice(0, 10),
    total: {
      count: 0,
      p50_ms: null,
      p90_ms: null,
      p95_ms: null,
      p99_ms: null,
    },
    observations: [],
  };
}

export function emptyLangfuseToolErrors(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildToolErrors>> {
  return { from_date: fromTs.slice(0, 10), to_date: toTs.slice(0, 10), total: 0, rows: [] };
}

export function emptyLangfuseToolErrorsDaily(
  fromTs: string,
  toTs: string,
): Awaited<ReturnType<typeof buildToolErrorsDaily>> {
  return { from_date: fromTs.slice(0, 10), to_date: toTs.slice(0, 10), rows: [] };
}

export function emptyLangfuseRecentErrors(fromTs: string, toTs: string): Awaited<ReturnType<typeof buildRecentErrors>> {
  return {
    from_date: new Date(fromTs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    to_date: new Date(toTs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    traces: [],
    trace_fetch_errors: 0,
  };
}

export function emptyLangfuseModel(): Awaited<ReturnType<typeof buildModel>> {
  return { model: null, trace_id: null };
}
