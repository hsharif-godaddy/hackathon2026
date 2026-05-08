import { requireLokiEndpoint } from '@/lib/log-sources';

const SUMMARIZATION_EVENTS = [
  'summarization.background.complete',
  'summarization.detailed_llm.failure',
  'summarization.detailed_llm.token_budget_exceeded',
];

const PUBLISH_EVENT_REGEX = 'route\\.publish\\..*';

const WEBSOCKET_ERROR_EVENTS = ['websocket.conversation.error'];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface LokiMetricSeries {
  metric: Record<string, string>;
  values: Array<[number | string, string]>;
}

interface LokiMetricResponse {
  status?: string;
  error?: string;
  errorType?: string;
  data?: {
    resultType?: 'matrix';
    result?: LokiMetricSeries[];
  };
}

// Keep the label set in sync with LOKI_SOURCES['airo-agents'] in
// @/lib/log-sources — that's the canonical selector for the agents stream.
// Adding extra matchers (e.g. `service_name`) here silently excludes streams
// that lack the label and makes all direct Loki metric queries return zero.
function defaultAgentsStreamSelector(): string {
  const envLabel = (process.env.ENVIRONMENT_NAME || 'dev') === 'prod' ? 'prod' : 'dev';
  return `{job="airo-agents", env="${envLabel}"}`;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.^$*+?()[\]{}|\\"]/g, '\\$&');
}

function escapeLogQLString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toNs(date: Date): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}

function sampleTimestampMs(timestamp: number | string): number {
  const raw = String(timestamp);
  if (/^\d{16,}$/.test(raw)) {
    return Number(BigInt(raw) / 1_000_000n);
  }
  return Math.round(Number.parseFloat(raw) * 1000);
}

function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function hourStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

function resolveRange(startDate?: string, endDate?: string): { start: Date; end: Date } {
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end.getTime() - DAY_MS);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date format');
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('End date must be after start date');
  }

  return { start, end };
}

function eventRegex(events: string[]): string {
  return events.map(escapeRegex).join('|');
}

function eventCountQuery(events: string[]): string {
  return eventCountRegexQuery(eventRegex(events));
}

function eventCountRegexQuery(eventPattern: string): string {
  const regex = escapeLogQLString(eventPattern);
  return `sum by (event) (count_over_time(${defaultAgentsStreamSelector()} | json | event=~"${regex}" | app_id!="" [$__range]))`;
}

async function queryLokiMetricRange(queryTemplate: string, start: Date, end: Date, step: string, range: string): Promise<LokiMetricSeries[]> {
  const lokiEndpoint = requireLokiEndpoint('analytics Loki metrics').replace(/\/+$/, '');
  const lokiApiKey = process.env.LOKI_API_KEY || '';
  const query = queryTemplate.replaceAll('$__range', range);

  const params = new URLSearchParams({
    query,
    start: toNs(start),
    end: toNs(end),
    step,
  });

  let res: Response;
  try {
    res = await fetch(`${lokiEndpoint}/loki/api/v1/query_range?${params}`, {
      headers: lokiApiKey ? { Authorization: `Bearer ${lokiApiKey}` } : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(`Loki metric query network error: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err instanceof Error ? err : undefined,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '<body read failed>');
    throw new Error(`Loki metric query failed: HTTP ${res.status} - ${body.slice(0, 300)}`);
  }

  const json = await res.json() as LokiMetricResponse;
  if (json.status === 'error') {
    throw new Error(`Loki metric query returned status=error: ${json.errorType || 'unknown'} - ${json.error || 'no message'}`);
  }

  const result = json.data?.result;
  if (!Array.isArray(result)) {
    throw new Error('Loki metric query returned an unexpected response shape');
  }

  return result;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dailyEvaluationRange(start: Date, end: Date): { queryStart: Date; queryEnd: Date } {
  return {
    queryStart: addDays(dayStart(start), 1),
    queryEnd: addDays(dayStart(end), 1),
  };
}

function mapEventSamples(series: LokiMetricSeries[], bucketStartFromSample: (sampleMs: number) => string) {
  const counts = new Map<string, Map<string, number>>();

  for (const item of series) {
    const event = item.metric.event;
    if (!event) continue;

    for (const [timestamp, value] of item.values) {
      const count = Number(value);
      if (!Number.isFinite(count) || count === 0) continue;

      const bucket = bucketStartFromSample(sampleTimestampMs(timestamp));
      let eventCounts = counts.get(bucket);
      if (!eventCounts) {
        eventCounts = new Map();
        counts.set(bucket, eventCounts);
      }
      eventCounts.set(event, (eventCounts.get(event) || 0) + count);
    }
  }

  return counts;
}

function summarizationStatsFor(events: Map<string, number> | undefined) {
  const successful = events?.get('summarization.background.complete') || 0;
  const failed =
    (events?.get('summarization.detailed_llm.failure') || 0) +
    (events?.get('summarization.detailed_llm.token_budget_exceeded') || 0);
  return { total: successful + failed, successful, failed };
}

function publishStatsFor(events: Map<string, number> | undefined) {
  const begins =
    (events?.get('route.publish.strategy-selected') || 0) +
    (events?.get('route.publish.begin') || 0);
  const successes = events?.get('route.publish.success') || 0;
  const buildFailed =
    (events?.get('route.publish.default.build.failed') || 0) +
    (events?.get('route.publish.paas.build.failed') || 0) +
    (events?.get('route.publish.build.failed') || 0);
  const archiveFailed =
    (events?.get('route.publish.default.archive.failed') || 0) +
    (events?.get('route.publish.paas.archive.failed') || 0) +
    (events?.get('route.publish.archive.failed') || 0) +
    (events?.get('route.publish.git-archive.failed') || 0);

  return {
    begins,
    successes,
    build_failed: buildFailed,
    archive_failed: archiveFailed,
    failures: buildFailed + archiveFailed,
  };
}

export async function getDirectSummarizationStats(startDate?: string, endDate?: string) {
  const { start, end } = resolveRange(startDate, endDate);
  const { queryStart, queryEnd } = dailyEvaluationRange(start, end);
  const bucketStart = (sampleMs: number) => dayStart(new Date(sampleMs - 1)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountQuery(SUMMARIZATION_EVENTS), queryStart, queryEnd, '24h', '24h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);
  const dates = Array.from(eventCounts.keys()).sort();

  const daily_stats = dates.map((date) => ({
    date,
    ...summarizationStatsFor(eventCounts.get(date)),
    apps: 0,
  })).filter((day) => day.total > 0);

  return {
    total: daily_stats.reduce((sum, day) => sum + day.total, 0),
    daily_stats,
  };
}

export async function getDirectHourlySummarizationStats(date: string) {
  const start = dayStart(new Date(date));
  const end = addDays(start, 1);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid date format');
  const bucketStart = (sampleMs: number) => hourStart(new Date(sampleMs - 1)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountQuery(SUMMARIZATION_EVENTS), new Date(start.getTime() + HOUR_MS), end, '1h', '1h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);
  const hours = Array.from(eventCounts.keys()).sort();

  return {
    date,
    hourly_stats: hours.map((hour) => ({
      hour: new Date(hour).getUTCHours(),
      ...summarizationStatsFor(eventCounts.get(hour)),
      apps: 0,
    })).filter((hour) => hour.total > 0),
  };
}

export async function getDirectRollingHourlySummarizations() {
  const end = new Date();
  const queryStart = new Date(end.getTime() - 23 * HOUR_MS);
  const bucketStart = (sampleMs: number) => hourStart(new Date(sampleMs - HOUR_MS)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountQuery(SUMMARIZATION_EVENTS), queryStart, end, '1h', '1h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);

  return {
    start: new Date(end.getTime() - DAY_MS).toISOString(),
    end: end.toISOString(),
    hourly_stats: Array.from({ length: 24 }, (_, hoursAgo) => {
      const timestamp = hourStart(new Date(end.getTime() - (hoursAgo + 1) * HOUR_MS)).toISOString();
      return {
        hoursAgo,
        timestamp,
        ...summarizationStatsFor(eventCounts.get(timestamp)),
        apps: 0,
      };
    }),
  };
}

export async function getDirectPublishStats(startDate?: string, endDate?: string) {
  const { start, end } = resolveRange(startDate, endDate);
  const { queryStart, queryEnd } = dailyEvaluationRange(start, end);
  const bucketStart = (sampleMs: number) => dayStart(new Date(sampleMs - 1)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountRegexQuery(PUBLISH_EVENT_REGEX), queryStart, queryEnd, '24h', '24h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);
  const dates = Array.from(eventCounts.keys()).sort();

  let total = 0;
  let successes = 0;
  let failures = 0;
  const daily_stats = dates.map((date) => {
    const stats = publishStatsFor(eventCounts.get(date));
    total += stats.successes + stats.failures;
    successes += stats.successes;
    failures += stats.failures;
    return { date, apps: 0, ...stats };
  }).filter((day) => day.begins > 0 || day.successes > 0 || day.failures > 0);

  return { total, successes, failures, daily_stats };
}

export async function getDirectHourlyPublishStats(date: string) {
  const start = dayStart(new Date(date));
  const end = addDays(start, 1);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid date format');
  const bucketStart = (sampleMs: number) => hourStart(new Date(sampleMs - 1)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountRegexQuery(PUBLISH_EVENT_REGEX), new Date(start.getTime() + HOUR_MS), end, '1h', '1h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);
  const hours = Array.from(eventCounts.keys()).sort();

  return {
    date,
    hourly_stats: hours.map((hour) => ({
      hour,
      begins: publishStatsFor(eventCounts.get(hour)).begins,
      successes: publishStatsFor(eventCounts.get(hour)).successes,
      failures: publishStatsFor(eventCounts.get(hour)).failures,
    })).filter((hour) => hour.begins > 0 || hour.successes > 0 || hour.failures > 0),
  };
}

export async function getDirectRollingHourlyPublish() {
  const end = new Date();
  const queryStart = new Date(end.getTime() - 23 * HOUR_MS);
  const bucketStart = (sampleMs: number) => hourStart(new Date(sampleMs - HOUR_MS)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountRegexQuery(PUBLISH_EVENT_REGEX), queryStart, end, '1h', '1h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);

  return {
    start: new Date(end.getTime() - DAY_MS).toISOString(),
    end: end.toISOString(),
    hourly_stats: Array.from({ length: 24 }, (_, hoursAgo) => {
      const timestamp = hourStart(new Date(end.getTime() - (hoursAgo + 1) * HOUR_MS)).toISOString();
      const stats = publishStatsFor(eventCounts.get(timestamp));
      return {
        hoursAgo,
        timestamp,
        begins: stats.begins,
        successes: stats.successes,
        failures: stats.failures,
      };
    }),
  };
}

function websocketErrorCountFor(events: Map<string, number> | undefined) {
  return events?.get('websocket.conversation.error') || 0;
}

export async function getDirectWebsocketErrorStats(startDate?: string, endDate?: string) {
  const { start, end } = resolveRange(startDate, endDate);
  const { queryStart, queryEnd } = dailyEvaluationRange(start, end);
  const bucketStart = (sampleMs: number) => dayStart(new Date(sampleMs - 1)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountQuery(WEBSOCKET_ERROR_EVENTS), queryStart, queryEnd, '24h', '24h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);
  const dates = Array.from(eventCounts.keys()).sort();

  const daily_stats = dates.map((date) => ({
    date,
    errors: websocketErrorCountFor(eventCounts.get(date)),
    apps: 0,
  })).filter((day) => day.errors > 0);

  return {
    total: daily_stats.reduce((sum, day) => sum + day.errors, 0),
    daily_stats,
  };
}

export async function getDirectHourlyWebsocketErrorStats(date: string) {
  const start = dayStart(new Date(date));
  const end = addDays(start, 1);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid date format');
  const bucketStart = (sampleMs: number) => hourStart(new Date(sampleMs - 1)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountQuery(WEBSOCKET_ERROR_EVENTS), new Date(start.getTime() + HOUR_MS), end, '1h', '1h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);
  const hours = Array.from(eventCounts.keys()).sort();

  return {
    date,
    hourly_stats: hours.map((hour) => ({
      hour: new Date(hour).getUTCHours(),
      errors: websocketErrorCountFor(eventCounts.get(hour)),
      apps: 0,
    })).filter((h) => h.errors > 0),
  };
}

export async function getDirectRollingHourlyWebsocketErrors() {
  const end = new Date();
  const queryStart = new Date(end.getTime() - 23 * HOUR_MS);
  const bucketStart = (sampleMs: number) => hourStart(new Date(sampleMs - HOUR_MS)).toISOString();

  const eventSeries = await queryLokiMetricRange(eventCountQuery(WEBSOCKET_ERROR_EVENTS), queryStart, end, '1h', '1h');
  const eventCounts = mapEventSamples(eventSeries, bucketStart);

  return {
    start: new Date(end.getTime() - DAY_MS).toISOString(),
    end: end.toISOString(),
    hourly_stats: Array.from({ length: 24 }, (_, hoursAgo) => {
      const timestamp = hourStart(new Date(end.getTime() - (hoursAgo + 1) * HOUR_MS)).toISOString();
      return {
        hoursAgo,
        timestamp,
        errors: websocketErrorCountFor(eventCounts.get(timestamp)),
        apps: 0,
      };
    }),
  };
}
