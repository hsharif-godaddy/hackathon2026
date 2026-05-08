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
