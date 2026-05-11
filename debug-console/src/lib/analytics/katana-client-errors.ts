import { writeClient } from './es-client';

export const KATANA_CLIENT_ERROR_EVENTS = [
  'client.websocket.connection.error',
  'client.websocket.machine.stream.error',
  'client.websocket.client-action.publish.error',
  'client.paywall.eligibility.switchboard.check-failed',
  'client.paywall.eligibility.access-denied'
];

export const KATANA_BUDGET_ERROR_EVENTS = [
  'client.sse.send_message.budget_exceeded',
  'client.websocket.error.budget_exceeded'
];

// UI-triggered authentication failures. Covers SSO token-expiry rejections
// from the gd-auth server layer and websocket auth failures from the client
// — both fire during UI auth flows, so we aggregate them into one chart.
export const KATANA_UI_AUTH_EVENTS = [
  'gd-auth.authenticate.error',
  'auth.gdauth.validate.failed',
  'client.websocket.auth.failed',
  'client.websocket.auth.error',
];

export const KATANA_CLIENT_ERROR_INDEX = '.ds-logs-gdelastic.katana.app-prod-ecs-*';

function buildTimeFilter(startDate?: string, endDate?: string) {
  const filter: Array<Record<string, unknown>> = [];
  if (startDate || endDate) {
    filter.push({
      range: {
        '@timestamp': {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {})
        }
      }
    });
  }
  return filter;
}

function buildClientErrorQuery(startDate?: string, endDate?: string): Record<string, unknown> {
  const filter = buildTimeFilter(startDate, endDate);

  return {
    bool: {
      must: [
        { term: { level: 'error' } },
        { terms: { event: KATANA_CLIENT_ERROR_EVENTS } },
        {
          bool: {
            should: [
              { exists: { field: 'data.appId' } },
              { exists: { field: 'data.siteId' } }
            ],
            minimum_should_match: 1
          }
        }
      ],
      ...(filter.length > 0 ? { filter } : {})
    }
  };
}

function buildBudgetErrorQuery(startDate?: string, endDate?: string): Record<string, unknown> {
  const filter = buildTimeFilter(startDate, endDate);

  return {
    bool: {
      must: [
        { terms: { level: ['warn', 'error'] } },
        { terms: { event: KATANA_BUDGET_ERROR_EVENTS } }
      ],
      ...(filter.length > 0 ? { filter } : {})
    }
  };
}

function buildUiAuthEventQuery(startDate?: string, endDate?: string): Record<string, unknown> {
  const filter = buildTimeFilter(startDate, endDate);

  return {
    bool: {
      must: [
        { terms: { level: ['warn', 'error'] } },
        { terms: { event: KATANA_UI_AUTH_EVENTS } }
      ],
      ...(filter.length > 0 ? { filter } : {})
    }
  };
}

function uniqueAppsAgg() {
  return {
    cardinality: {
      field: 'data.appId'
    }
  };
}

function mapDailyErrorBuckets(result: Awaited<ReturnType<typeof writeClient.search>>) {
  const aggs = result.aggregations as Record<string, unknown>;
  const dayBuckets = (aggs.by_day as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  return {
    total: (result.hits.total as { value: number }).value,
    daily_stats: dayBuckets.map(b => ({
      date: b.key_as_string,
      errors: b.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

function mapHourlyErrorBuckets(result: Awaited<ReturnType<typeof writeClient.search>>, date: string) {
  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];

  return {
    date,
    hourly_stats: hourBuckets.map(b => ({
      hour: new Date(b.key_as_string).getUTCHours(),
      errors: b.doc_count,
      apps: b.unique_apps.value
    }))
  };
}

function mapRollingHourlyErrorBuckets(result: Awaited<ReturnType<typeof writeClient.search>>, start: Date, end: Date) {
  const aggs = result.aggregations as Record<string, unknown>;
  const hourBuckets = (aggs.by_hour as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];
  const nowHour = end.getTime();

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    hourly_stats: hourBuckets.map(b => {
      const bucketTime = new Date(b.key_as_string).getTime();
      return {
        hoursAgo: Math.floor((nowHour - bucketTime) / (60 * 60 * 1000)),
        timestamp: b.key_as_string,
        errors: b.doc_count,
        apps: b.unique_apps.value
      };
    })
  };
}

// Rolling last-1h view with 5-minute buckets (12 buckets total). Bucket index
// (`minutesAgo`) is the bucket's *start-of-interval* distance from now in
// minutes — 0 is the current 5-min window, 5 is five minutes ago, etc.
//
// ES `date_histogram` with fixed_interval=5m aligns to fixed boundaries, so a
// 1h window can span 13 buckets when the window's start/end fall inside two
// different 5-min boundaries. Cap at 12 by filtering on `minutesAgo < 60` so
// the UI chart always gets exactly 12 slots.
function mapRolling5MinErrorBuckets(result: Awaited<ReturnType<typeof writeClient.search>>, start: Date, end: Date) {
  const aggs = result.aggregations as Record<string, unknown>;
  const buckets = (aggs.by_5min as { buckets: Array<{ key_as_string: string; doc_count: number; unique_apps: { value: number } }> })?.buckets || [];
  const now = end.getTime();

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    minute_stats: buckets
      .map(b => {
        const bucketTime = new Date(b.key_as_string).getTime();
        return {
          minutesAgo: Math.floor((now - bucketTime) / (60 * 1000) / 5) * 5,
          timestamp: b.key_as_string,
          errors: b.doc_count,
          apps: b.unique_apps.value
        };
      })
      .filter(b => b.minutesAgo >= 0 && b.minutesAgo < 60)
  };
}

export async function getDirectClientErrorStats(startDate?: string, endDate?: string) {
  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    track_total_hits: true,
    body: {
      query: buildClientErrorQuery(startDate, endDate),
      aggs: {
        by_day: {
          date_histogram: { field: '@timestamp', calendar_interval: '1d' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapDailyErrorBuckets(result);
}

export async function getDirectHourlyClientErrorStats(date: string) {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildClientErrorQuery(startOfDay.toISOString(), endOfDay.toISOString()),
      aggs: {
        by_hour: {
          date_histogram: { field: '@timestamp', calendar_interval: '1h' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapHourlyErrorBuckets(result, date);
}

export async function getDirectRollingHourlyClientErrors() {
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildClientErrorQuery(past24h.toISOString(), now.toISOString()),
      aggs: {
        by_hour: {
          date_histogram: { field: '@timestamp', fixed_interval: '1h' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapRollingHourlyErrorBuckets(result, past24h, now);
}

export async function getDirectBudgetErrorStats(startDate?: string, endDate?: string) {
  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    track_total_hits: true,
    body: {
      query: buildBudgetErrorQuery(startDate, endDate),
      aggs: {
        by_day: {
          date_histogram: { field: '@timestamp', calendar_interval: '1d' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapDailyErrorBuckets(result);
}

export async function getDirectHourlyBudgetErrorStats(date: string) {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildBudgetErrorQuery(startOfDay.toISOString(), endOfDay.toISOString()),
      aggs: {
        by_hour: {
          date_histogram: { field: '@timestamp', calendar_interval: '1h' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapHourlyErrorBuckets(result, date);
}

export async function getDirectRollingHourlyBudgetErrors() {
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildBudgetErrorQuery(past24h.toISOString(), now.toISOString()),
      aggs: {
        by_hour: {
          date_histogram: { field: '@timestamp', fixed_interval: '1h' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapRollingHourlyErrorBuckets(result, past24h, now);
}

export async function getDirectUiAuthEventStats(startDate?: string, endDate?: string) {
  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    track_total_hits: true,
    body: {
      query: buildUiAuthEventQuery(startDate, endDate),
      aggs: {
        by_day: {
          date_histogram: { field: '@timestamp', calendar_interval: '1d' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapDailyErrorBuckets(result);
}

export async function getDirectHourlyUiAuthEventStats(date: string) {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildUiAuthEventQuery(startOfDay.toISOString(), endOfDay.toISOString()),
      aggs: {
        by_hour: {
          date_histogram: { field: '@timestamp', calendar_interval: '1h' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapHourlyErrorBuckets(result, date);
}

export async function getDirectRollingHourlyUiAuthEvents() {
  const now = new Date();
  const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildUiAuthEventQuery(past24h.toISOString(), now.toISOString()),
      aggs: {
        by_hour: {
          date_histogram: { field: '@timestamp', fixed_interval: '1h' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapRollingHourlyErrorBuckets(result, past24h, now);
}

// --- Rolling last-1h with 5-minute buckets -------------------------------
// These power the "1h" preset on the analytics Dynamic section. Each returns
// 12 buckets of 5-min width over the last hour (fixed_interval=5m).

export async function getDirectLast1HourClientErrors() {
  const now = new Date();
  const past1h = new Date(now.getTime() - 60 * 60 * 1000);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildClientErrorQuery(past1h.toISOString(), now.toISOString()),
      aggs: {
        by_5min: {
          date_histogram: { field: '@timestamp', fixed_interval: '5m' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapRolling5MinErrorBuckets(result, past1h, now);
}

export async function getDirectLast1HourBudgetErrors() {
  const now = new Date();
  const past1h = new Date(now.getTime() - 60 * 60 * 1000);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildBudgetErrorQuery(past1h.toISOString(), now.toISOString()),
      aggs: {
        by_5min: {
          date_histogram: { field: '@timestamp', fixed_interval: '5m' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapRolling5MinErrorBuckets(result, past1h, now);
}

export async function getDirectLast1HourUiAuthEvents() {
  const now = new Date();
  const past1h = new Date(now.getTime() - 60 * 60 * 1000);

  const result = await writeClient.search({
    index: KATANA_CLIENT_ERROR_INDEX,
    size: 0,
    body: {
      query: buildUiAuthEventQuery(past1h.toISOString(), now.toISOString()),
      aggs: {
        by_5min: {
          date_histogram: { field: '@timestamp', fixed_interval: '5m' },
          aggs: { unique_apps: uniqueAppsAgg() }
        }
      }
    }
  });

  return mapRolling5MinErrorBuckets(result, past1h, now);
}
