import { c1Query, chFirstNumber } from '@/lib/clickhouse-c1-client';

const FUNNEL_STEPS: [string, string][] = [
  ['Homepage view', 'appbuilder.homepage.page.view.impression'],
  ['Prompt submit', 'appbuilder.homepage.prompt.submit.click'],
  ['First publish click', 'appbuilder.develop.header.app_first_publish.click'],
  ['Returning publish click', 'appbuilder.develop.header.app_publish.click'],
  ['Upgrade click', 'appbuilder.develop.header.upgrade.click'],
  ['Plan purchase success', 'appbuilder.plan.purchase.success.impression'],
];

export type C1Period = 'day' | 'week' | '14days' | '15days' | 'month';

export function isC1Period(v: string): v is C1Period {
  return v === 'day' || v === 'week' || v === '14days' || v === '15days' || v === 'month';
}

function funnelCalendarDaySpan(period: C1Period): number {
  if (period === 'day') return 1;
  if (period === 'week') return 7;
  if (period === '14days') return 14;
  if (period === '15days') return 15;
  return 30;
}

export async function buildDau() {
  const rows = await c1Query(`
            SELECT
              COUNT(DISTINCT visitor_id) AS today_dau
            FROM analytics.c1_events
            WHERE event_type = 'page-view'
              AND event_date = today()
        `);
  return { today_dau: Math.trunc(chFirstNumber(rows[0], ['today_dau'])) };
}

export interface C1Engagement7dRow {
  ymd: string;
  label: string;
  dau: number;
  wau: number;
}

function dayLabelFromYmd(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[1]}/${parts[2]}`;
}

/** Last 7 UTC calendar days: DAU per day and rolling 7-day unique visitors (WAU) ending each day. */
export async function buildEngagement7d(): Promise<C1Engagement7dRow[]> {
  const rows = await c1Query<Record<string, unknown>>(`
            WITH days AS (
              SELECT toDate(today() - (6 - number)) AS d
              FROM numbers(7)
            )
            SELECT
              toString(day_row.d) AS ymd,
              countDistinctIf(j.visitor_id, j.event_date = day_row.d) AS dau,
              countDistinct(j.visitor_id) AS wau
            FROM days AS day_row
            LEFT JOIN (
              SELECT
                day_anchor.d AS join_d,
                e.visitor_id,
                e.event_date
              FROM days AS day_anchor
              CROSS JOIN (
                SELECT visitor_id, event_date
                FROM analytics.c1_events
                WHERE event_type = 'page-view'
                  AND event_date >= addDays(toDate(today()), -12)
                  AND event_date <= toDate(today())
              ) AS e
              WHERE e.event_date BETWEEN addDays(day_anchor.d, -6) AND day_anchor.d
            ) AS j ON j.join_d = day_row.d
            GROUP BY day_row.d
            ORDER BY day_row.d ASC
        `);
  return rows.map(function mapEngagementRow(r) {
    const ymd = String(r.ymd ?? '');
    return {
      ymd,
      label: dayLabelFromYmd(ymd),
      dau: Math.trunc(chFirstNumber(r, ['dau'])),
      wau: Math.trunc(chFirstNumber(r, ['wau'])),
    };
  });
}

export async function buildWau() {
  const rows = await c1Query(`
            SELECT
              curr_wau,
              prev_wau,
              (curr_wau - prev_wau) * 100.0 / prev_wau AS pct_change
            FROM (
              SELECT
                COUNT(DISTINCT IF(event_date >= today() - 6, visitor_id, NULL)) AS curr_wau,
                COUNT(DISTINCT IF(event_date >= today() - 13 AND event_date <= today() - 7,
                                  visitor_id, NULL)) AS prev_wau
              FROM analytics.c1_events
              WHERE event_type = 'page-view'
            )
        `);
  const r = rows[0];
  const curr_wau = Math.trunc(chFirstNumber(r, ['curr_wau']));
  const prev_wau = Math.trunc(chFirstNumber(r, ['prev_wau']));
  const pctRaw = chFirstNumber(r, ['pct_change']);
  return {
    curr_wau,
    prev_wau,
    pct_change: prev_wau ? Math.round(pctRaw * 10) / 10 : 0,
  };
}

export async function buildFunnel(period: C1Period) {
  const span = funnelCalendarDaySpan(period);
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = utcToday.toISOString().slice(0, 10);
  const startDate = new Date(utcToday.getTime() - (span - 1) * 24 * 60 * 60 * 1000);
  const start = startDate.toISOString().slice(0, 10);

  const eids = FUNNEL_STEPS.map(([, eid]) => `'${eid.replace(/'/g, "''")}'`).join(', ');
  const rows = await c1Query<{ eid: string; unique_visitors: unknown }>(`
            SELECT eid, countDistinct(visitor_id) AS unique_visitors
            FROM analytics.c1_events
            WHERE eid IN (${eids}) AND event_date BETWEEN '${start}' AND '${end}'
            GROUP BY eid
        `);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    const eid = String(row.eid ?? '');
    counts[eid] = Math.trunc(chFirstNumber(row, ['unique_visitors']));
  }

  let top: number | null = null;
  let prev: number | null = null;
  const steps: {
    label: string;
    eid: string;
    count: number;
    pct_of_top: number;
    pct_of_prev: number;
  }[] = [];

  for (const [label, eid] of FUNNEL_STEPS) {
    const count = counts[eid] ?? 0;
    if (top === null) top = count;
    steps.push({
      label,
      eid,
      count,
      pct_of_top: top ? Math.round((count / top) * 1000) / 10 : 0,
      pct_of_prev:
        prev === null ? 100 : prev > 0 ? Math.round((count / prev) * 1000) / 10 : 0,
    });
    prev = count;
  }

  return { from_date: start, to_date: end, period, steps };
}

function sessionsSql(period: C1Period): string {
  if (period === 'day') {
    return `
                SELECT
                  curr_sessions,
                  prev_sessions,
                  (curr_sessions - prev_sessions) * 100.0 / prev_sessions AS pct_change
                FROM (
                  SELECT
                    COUNT(DISTINCT IF(processed_timestamp >= now() - INTERVAL 1 DAY,
                                      session_id, NULL)) AS curr_sessions,
                    COUNT(DISTINCT IF(processed_timestamp < now() - INTERVAL 1 DAY
                                      AND processed_timestamp >= now() - INTERVAL 2 DAY,
                                      session_id, NULL)) AS prev_sessions
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                )
            `;
  }
  if (period === 'week') {
    return `
                SELECT
                  curr_sessions,
                  prev_sessions,
                  (curr_sessions - prev_sessions) * 100.0 / prev_sessions AS pct_change
                FROM (
                  SELECT
                    COUNT(DISTINCT IF(processed_timestamp >= now() - INTERVAL 7 DAY,
                                      session_id, NULL)) AS curr_sessions,
                    COUNT(DISTINCT IF(processed_timestamp < now() - INTERVAL 7 DAY
                                      AND processed_timestamp >= now() - INTERVAL 14 DAY,
                                      session_id, NULL)) AS prev_sessions
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                )
            `;
  }
  if (period === '14days') {
    return `
                SELECT
                  curr_sessions,
                  prev_sessions,
                  (curr_sessions - prev_sessions) * 100.0 / prev_sessions AS pct_change
                FROM (
                  SELECT
                    COUNT(DISTINCT IF(processed_timestamp >= now() - INTERVAL 14 DAY,
                                      session_id, NULL)) AS curr_sessions,
                    COUNT(DISTINCT IF(processed_timestamp < now() - INTERVAL 14 DAY
                                      AND processed_timestamp >= now() - INTERVAL 28 DAY,
                                      session_id, NULL)) AS prev_sessions
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                )
            `;
  }
  if (period === '15days') {
    return `
                SELECT
                  curr_sessions,
                  prev_sessions,
                  (curr_sessions - prev_sessions) * 100.0 / prev_sessions AS pct_change
                FROM (
                  SELECT
                    COUNT(DISTINCT IF(processed_timestamp >= now() - INTERVAL 15 DAY,
                                      session_id, NULL)) AS curr_sessions,
                    COUNT(DISTINCT IF(processed_timestamp < now() - INTERVAL 15 DAY
                                      AND processed_timestamp >= now() - INTERVAL 30 DAY,
                                      session_id, NULL)) AS prev_sessions
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                )
            `;
  }
  return `
                SELECT
                  curr_sessions,
                  prev_sessions,
                  (curr_sessions - prev_sessions) * 100.0 / prev_sessions AS pct_change
                FROM (
                  SELECT
                    COUNT(DISTINCT IF(processed_timestamp >= now() - INTERVAL 30 DAY,
                                      session_id, NULL)) AS curr_sessions,
                    COUNT(DISTINCT IF(processed_timestamp < now() - INTERVAL 30 DAY
                                      AND processed_timestamp >= now() - INTERVAL 60 DAY,
                                      session_id, NULL)) AS prev_sessions
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                )
            `;
}

export async function buildSessions(period: C1Period) {
  const rows = await c1Query(sessionsSql(period));
  const r = rows[0];
  const curr_sessions = Math.trunc(chFirstNumber(r, ['curr_sessions']));
  const prev_sessions = Math.trunc(chFirstNumber(r, ['prev_sessions']));
  const pctRaw = chFirstNumber(r, ['pct_change']);
  return {
    curr_sessions,
    prev_sessions,
    pct_change: prev_sessions ? Math.round(pctRaw * 10) / 10 : 0,
    period,
  };
}

function avgSessionSql(period: C1Period): string {
  if (period === 'day') {
    return `
                WITH sessions AS (
                  SELECT
                    session_id,
                    MIN(processed_timestamp) AS start_ts,
                    MAX(processed_timestamp) AS end_ts
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                    AND processed_timestamp >= now() - INTERVAL 2 DAY
                  GROUP BY session_id
                ),
                labeled AS (
                  SELECT
                    session_id,
                    dateDiff('second', start_ts, end_ts) AS duration_sec,
                    IF(start_ts >= now() - INTERVAL 1 DAY, 'curr', 'prev') AS period
                  FROM sessions
                )
                SELECT
                  AVGIf(duration_sec, period = 'curr') / 60 AS curr_avg_min,
                  AVGIf(duration_sec, period = 'prev') / 60 AS prev_avg_min,
                  (curr_avg_min - prev_avg_min) * 100.0 / NULLIF(prev_avg_min, 0) AS pct_change
                FROM labeled
            `;
  }
  if (period === 'week') {
    return `
                WITH sessions AS (
                  SELECT
                    session_id,
                    MIN(processed_timestamp) AS start_ts,
                    MAX(processed_timestamp) AS end_ts
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                    AND processed_timestamp >= now() - INTERVAL 14 DAY
                  GROUP BY session_id
                ),
                labeled AS (
                  SELECT
                    session_id,
                    dateDiff('second', start_ts, end_ts) AS duration_sec,
                    IF(start_ts >= now() - INTERVAL 7 DAY, 'curr', 'prev') AS period
                  FROM sessions
                )
                SELECT
                  AVGIf(duration_sec, period = 'curr') / 60 AS curr_avg_min,
                  AVGIf(duration_sec, period = 'prev') / 60 AS prev_avg_min,
                  (curr_avg_min - prev_avg_min) * 100.0 / NULLIF(prev_avg_min, 0) AS pct_change
                FROM labeled
            `;
  }
  if (period === '14days') {
    return `
                WITH sessions AS (
                  SELECT
                    session_id,
                    MIN(processed_timestamp) AS start_ts,
                    MAX(processed_timestamp) AS end_ts
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                    AND processed_timestamp >= now() - INTERVAL 28 DAY
                  GROUP BY session_id
                ),
                labeled AS (
                  SELECT
                    session_id,
                    dateDiff('second', start_ts, end_ts) AS duration_sec,
                    IF(start_ts >= now() - INTERVAL 14 DAY, 'curr', 'prev') AS period
                  FROM sessions
                )
                SELECT
                  AVGIf(duration_sec, period = 'curr') / 60 AS curr_avg_min,
                  AVGIf(duration_sec, period = 'prev') / 60 AS prev_avg_min,
                  (curr_avg_min - prev_avg_min) * 100.0 / NULLIF(prev_avg_min, 0) AS pct_change
                FROM labeled
            `;
  }
  if (period === '15days') {
    return `
                WITH sessions AS (
                  SELECT
                    session_id,
                    MIN(processed_timestamp) AS start_ts,
                    MAX(processed_timestamp) AS end_ts
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                    AND processed_timestamp >= now() - INTERVAL 30 DAY
                  GROUP BY session_id
                ),
                labeled AS (
                  SELECT
                    session_id,
                    dateDiff('second', start_ts, end_ts) AS duration_sec,
                    IF(start_ts >= now() - INTERVAL 15 DAY, 'curr', 'prev') AS period
                  FROM sessions
                )
                SELECT
                  AVGIf(duration_sec, period = 'curr') / 60 AS curr_avg_min,
                  AVGIf(duration_sec, period = 'prev') / 60 AS prev_avg_min,
                  (curr_avg_min - prev_avg_min) * 100.0 / NULLIF(prev_avg_min, 0) AS pct_change
                FROM labeled
            `;
  }
  return `
                WITH sessions AS (
                  SELECT
                    session_id,
                    MIN(processed_timestamp) AS start_ts,
                    MAX(processed_timestamp) AS end_ts
                  FROM analytics.c1_events
                  WHERE event_type = 'page-view'
                    AND processed_timestamp >= now() - INTERVAL 60 DAY
                  GROUP BY session_id
                ),
                labeled AS (
                  SELECT
                    session_id,
                    dateDiff('second', start_ts, end_ts) AS duration_sec,
                    IF(start_ts >= now() - INTERVAL 30 DAY, 'curr', 'prev') AS period
                  FROM sessions
                )
                SELECT
                  AVGIf(duration_sec, period = 'curr') / 60 AS curr_avg_min,
                  AVGIf(duration_sec, period = 'prev') / 60 AS prev_avg_min,
                  (curr_avg_min - prev_avg_min) * 100.0 / NULLIF(prev_avg_min, 0) AS pct_change
                FROM labeled
            `;
}

export async function buildAvgSession(period: C1Period) {
  const rows = await c1Query(avgSessionSql(period));
  const r = rows[0];
  const curr_avg_min = chFirstNumber(r, ['curr_avg_min']);
  const prev_avg_min = chFirstNumber(r, ['prev_avg_min']);
  const pct_change = chFirstNumber(r, ['pct_change']);
  return {
    curr_avg_min: Math.round(curr_avg_min * 100) / 100,
    prev_avg_min: Math.round(prev_avg_min * 100) / 100,
    pct_change: Math.round(pct_change * 10) / 10,
    period,
  };
}

function tasksPerSessionSql(period: C1Period): string {
  if (period === 'day') {
    return `
                WITH base AS (
                  SELECT
                    session_id,
                    COUNTIf(event_type = 'click') AS clicks,
                    IF(event_date >= today() - 1, 'curr', 'prev') AS period
                  FROM analytics.c1_events
                  WHERE event_type IN ('click', 'page-view')
                    AND event_date >= today() - 2
                  GROUP BY session_id, period
                )
                SELECT
                  AVGIf(clicks, period = 'curr') AS curr_clicks_per_session,
                  AVGIf(clicks, period = 'prev') AS prev_clicks_per_session,
                  curr_clicks_per_session - prev_clicks_per_session AS absolute_change,
                  (curr_clicks_per_session - prev_clicks_per_session)
                    * 100.0 / NULLIF(prev_clicks_per_session, 0) AS pct_change
                FROM base
            `;
  }
  if (period === 'week') {
    return `
                WITH base AS (
                  SELECT
                    session_id,
                    COUNTIf(event_type = 'click') AS clicks,
                    IF(event_date >= today() - 7, 'curr', 'prev') AS period
                  FROM analytics.c1_events
                  WHERE event_type IN ('click', 'page-view')
                    AND event_date >= today() - 14
                  GROUP BY session_id, period
                )
                SELECT
                  AVGIf(clicks, period = 'curr') AS curr_clicks_per_session,
                  AVGIf(clicks, period = 'prev') AS prev_clicks_per_session,
                  curr_clicks_per_session - prev_clicks_per_session AS absolute_change,
                  (curr_clicks_per_session - prev_clicks_per_session)
                    * 100.0 / NULLIF(prev_clicks_per_session, 0) AS pct_change
                FROM base
            `;
  }
  if (period === '14days') {
    return `
                WITH base AS (
                  SELECT
                    session_id,
                    COUNTIf(event_type = 'click') AS clicks,
                    IF(event_date >= today() - 14, 'curr', 'prev') AS period
                  FROM analytics.c1_events
                  WHERE event_type IN ('click', 'page-view')
                    AND event_date >= today() - 28
                  GROUP BY session_id, period
                )
                SELECT
                  AVGIf(clicks, period = 'curr') AS curr_clicks_per_session,
                  AVGIf(clicks, period = 'prev') AS prev_clicks_per_session,
                  curr_clicks_per_session - prev_clicks_per_session AS absolute_change,
                  (curr_clicks_per_session - prev_clicks_per_session)
                    * 100.0 / NULLIF(prev_clicks_per_session, 0) AS pct_change
                FROM base
            `;
  }
  if (period === '15days') {
    return `
                WITH base AS (
                  SELECT
                    session_id,
                    COUNTIf(event_type = 'click') AS clicks,
                    IF(event_date >= today() - 15, 'curr', 'prev') AS period
                  FROM analytics.c1_events
                  WHERE event_type IN ('click', 'page-view')
                    AND event_date >= today() - 30
                  GROUP BY session_id, period
                )
                SELECT
                  AVGIf(clicks, period = 'curr') AS curr_clicks_per_session,
                  AVGIf(clicks, period = 'prev') AS prev_clicks_per_session,
                  curr_clicks_per_session - prev_clicks_per_session AS absolute_change,
                  (curr_clicks_per_session - prev_clicks_per_session)
                    * 100.0 / NULLIF(prev_clicks_per_session, 0) AS pct_change
                FROM base
            `;
  }
  return `
                WITH base AS (
                  SELECT
                    session_id,
                    COUNTIf(event_type = 'click') AS clicks,
                    IF(event_date >= today() - 30, 'curr', 'prev') AS period
                  FROM analytics.c1_events
                  WHERE event_type IN ('click', 'page-view')
                    AND event_date >= today() - 60
                  GROUP BY session_id, period
                )
                SELECT
                  AVGIf(clicks, period = 'curr') AS curr_clicks_per_session,
                  AVGIf(clicks, period = 'prev') AS prev_clicks_per_session,
                  curr_clicks_per_session - prev_clicks_per_session AS absolute_change,
                  (curr_clicks_per_session - prev_clicks_per_session)
                    * 100.0 / NULLIF(prev_clicks_per_session, 0) AS pct_change
                FROM base
            `;
}

export async function buildTasksPerSession(period: C1Period) {
  const rows = await c1Query(tasksPerSessionSql(period));
  const r = rows[0];
  const curr = chFirstNumber(r, ['curr_clicks_per_session']);
  const prev = chFirstNumber(r, ['prev_clicks_per_session']);
  const abs_change = chFirstNumber(r, ['absolute_change']);
  const pct_change = chFirstNumber(r, ['pct_change']);
  return {
    curr_clicks_per_session: Math.round(curr * 100) / 100,
    prev_clicks_per_session: Math.round(prev * 100) / 100,
    absolute_change: Math.round(abs_change * 100) / 100,
    pct_change: Math.round(pct_change * 10) / 10,
    period,
  };
}

export async function buildC1Bundle(period: C1Period) {
  const [dau, wau, funnel, sessions, avgSession, tasksPerSession, engagement7d] = await Promise.all([
    buildDau(),
    buildWau(),
    buildFunnel(period),
    buildSessions(period),
    buildAvgSession(period),
    buildTasksPerSession(period),
    buildEngagement7d(),
  ]);
  return {
    period,
    dau,
    wau,
    funnel,
    sessions,
    avgSession,
    tasksPerSession,
    engagement7d,
  };
}
