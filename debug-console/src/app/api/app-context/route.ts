import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdQuery, getAllLogSources, getNestedValue } from '@/lib/log-sources';
import type { FieldMapping } from '@/lib/log-sources';
import { parseTimeRange } from '@/lib/time-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LogSourceData {
  message?: string;
  [key: string]: unknown;
}

interface LogEntry {
  _id: string;
  _source: {
    '@timestamp': string;
    level?: string;
    message?: string;
    event?: string;
    app_id?: string;
    conversationId?: string;
    threadId?: string;
    traceId?: string;
    logger?: string;
    service?: string;
    hostname?: string;
    environment?: string;
    region?: string;
    version?: string;
    data?: LogSourceData;
    [key: string]: unknown;
  };
}

interface ESSearchResponse {
  hits: {
    total: { value: number };
    hits: LogEntry[];
  };
}

interface APMTrace {
  '@timestamp': string;
  span?: {
    name?: string;
    duration?: {
      us?: number;
    };
  };
  labels?: {
    app_id?: string;
    [key: string]: unknown;
  };
  processor?: {
    event?: string;
  };
  [key: string]: unknown;
}

interface APMTracesResult {
  traces: APMTrace[];
  pagination: {
    hasMore: boolean;
    total: number;
    page: number;
    pageSize: number;
  };
}

interface LifetimeActivityStats {
  lastActivity?: string;
}

interface AppContext {
  appId: string;
  metadata: {
    name?: string;
    status?: string;
    template?: string;
    version?: string;
    createdAt?: string;
    lastActivity?: string;
    subscriptionId?: string;  // billing sid: airo-build:sid:<sid>
  };
  recentActivity: Array<{
    id: string;
    timestamp: string;
    level: string;
    message: string;
    event?: string;
    service?: string;
    source?: string;
    raw: Record<string, unknown>;
  }>;
  errorSummary: {
    total: number;
    last24Hours: number;
    errorGroups: Array<{
      message: string;
      count: number;
      lastSeen?: string;
      event?: string;
    }>;
  };
  activityStats: {
    totalLogs: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byEvent: Record<string, number>;
  };
  lifetimeStats: LifetimeActivityStats;
  conversations: Array<{
    conversationId: string;
    lastActivity: string;
    eventCount: number;
  }>;
  apmTraces: {
    total: number;
    traces: Array<{
      timestamp: string;
      spanName?: string;
      duration?: number;
      raw: Record<string, unknown>;
    }>;
    pagination: {
      hasMore: boolean;
      total: number;
      page: number;
      pageSize: number;
    };
  };
}

interface LogEntryWithSourceConfig extends LogEntry {
  _sourceId?: string;
  _fieldMapping?: FieldMapping;
}

async function fetchLogsForApp(
  appId: string,
  sourceIds: string[],
  timeRange: string = '24h',
  customStartTime?: string,
  customEndTime?: string
): Promise<LogEntryWithSourceConfig[]> {
  const allLogs: LogEntryWithSourceConfig[] = [];
  const sources = getAllLogSources();

  const { startTime, endTime } = parseTimeRange(timeRange, { customStartTime, customEndTime });

  for (const sourceId of sourceIds) {
    const sourceConfig = sources.find((s) => s.id === sourceId);
    if (!sourceConfig || !sourceConfig.apiKey) continue;

    const { fieldMapping } = sourceConfig;

    // Build query conditions
    const mustClauses: Record<string, unknown>[] = [
      {
        range: {
          [fieldMapping.timestampField]: {
            gte: startTime.toISOString(),
            lte: endTime.toISOString()
          }
        }
      }
    ];

    // Add app ID filter if this source supports it
    const appIdQuery = buildAppIdQuery(appId, fieldMapping);
    if (appIdQuery) {
      mustClauses.push(appIdQuery);
    }

    try {
      const esQuery = {
        size: 1000,
        from: 0,
        sort: [{ [fieldMapping.timestampField]: { order: 'desc' } }],
        query: {
          bool: {
            must: mustClauses
          }
        }
      };

      const response = await fetch(
        `${sourceConfig.endpoint}/${sourceConfig.index}/_search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `ApiKey ${sourceConfig.apiKey}`
          },
          body: JSON.stringify(esQuery)
        }
      );

      if (response.ok) {
        const data: ESSearchResponse = await response.json();
        const logsWithSource = data.hits.hits.map((log) => ({
          ...log,
          _sourceId: sourceId,
          _fieldMapping: fieldMapping
        }));
        allLogs.push(...logsWithSource);
      }
    } catch (error) {
      console.error('Error fetching logs from source:', sourceId, error);
    }
  }

  return allLogs.sort(
    (a, b) =>
      new Date(b._source['@timestamp']).getTime() -
      new Date(a._source['@timestamp']).getTime()
  );
}

interface AggBucket {
  key: string;
  doc_count: number;
  last_seen?: { value_as_string?: string };
  top_event?: { buckets?: Array<{ key: string }> };
}

function mergeAggregationBuckets(
  buckets: AggBucket[] | undefined,
  map: Map<string, { count: number; lastSeen: string | null; event: string | null }>
): void {
  if (!buckets) return;
  for (const bucket of buckets) {
    const msg = bucket.key;
    if (msg && msg.trim()) {
      const existing = map.get(msg) || { count: 0, lastSeen: null, event: null };
      const bucketLastSeen = bucket.last_seen?.value_as_string || null;
      const bucketEvent = bucket.top_event?.buckets?.[0]?.key || null;
      const newLastSeen = bucketLastSeen && (!existing.lastSeen || bucketLastSeen > existing.lastSeen)
        ? bucketLastSeen
        : existing.lastSeen;
      map.set(msg, {
        count: existing.count + bucket.doc_count,
        lastSeen: newLastSeen,
        event: existing.event || bucketEvent
      });
    }
  }
}

interface ErrorGroup {
  message: string;
  count: number;
  lastSeen?: string;
  event?: string;
}

interface ErrorSummaryResult {
  total: number;
  last24Hours: number;
  errorGroups: ErrorGroup[];
}

async function fetchErrorSummary(
  appId: string,
  sourceIds: string[],
  timeRange: string = '24h'
): Promise<ErrorSummaryResult> {
  const sources = getAllLogSources();

  const { startTime, endTime } = parseTimeRange(timeRange);
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let totalErrors = 0;
  let last24HoursCount = 0;
  const messageCountMap = new Map<string, { count: number; lastSeen: string | null; event: string | null }>();

  for (const sourceId of sourceIds) {
    const sourceConfig = sources.find((s) => s.id === sourceId);
    if (!sourceConfig || !sourceConfig.apiKey) continue;

    const { fieldMapping } = sourceConfig;

    const mustClauses: Record<string, unknown>[] = [
      {
        range: {
          [fieldMapping.timestampField]: {
            gte: startTime.toISOString(),
            lte: endTime.toISOString()
          }
        }
      },
      {
        match: {
          [fieldMapping.levelField]: 'error'
        }
      }
    ];

    const appIdQuery = buildAppIdQuery(appId, fieldMapping);
    if (appIdQuery) {
      mustClauses.push(appIdQuery);
    }

    try {
      const esQuery = {
        size: 0,
        query: {
          bool: {
            must: mustClauses
          }
        },
        aggs: {
          last_24h_count: {
            filter: {
              range: {
                [fieldMapping.timestampField]: {
                  gte: last24Hours.toISOString()
                }
              }
            }
          },
          error_messages: {
            terms: {
              field: fieldMapping.messageField + '.keyword',
              size: 20
            },
            aggs: {
              last_seen: {
                max: {
                  field: fieldMapping.timestampField
                }
              },
              top_event: {
                terms: {
                  field: 'event.keyword',
                  size: 1
                }
              }
            }
          },
          data_error_messages: {
            terms: {
              field: 'data.error.keyword',
              size: 20
            },
            aggs: {
              last_seen: {
                max: {
                  field: fieldMapping.timestampField
                }
              },
              top_event: {
                terms: {
                  field: 'event.keyword',
                  size: 1
                }
              }
            }
          },
          data_message_errors: {
            terms: {
              field: 'data.message.keyword',
              size: 20
            },
            aggs: {
              last_seen: {
                max: {
                  field: fieldMapping.timestampField
                }
              },
              top_event: {
                terms: {
                  field: 'event.keyword',
                  size: 1
                }
              }
            }
          }
        }
      };
      const response = await fetch(
        `${sourceConfig.endpoint}/${sourceConfig.index}/_search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `ApiKey ${sourceConfig.apiKey}`
          },
          body: JSON.stringify(esQuery)
        }
      );

      if (response.ok) {
        const data = await response.json();

        totalErrors += data.hits?.total?.value || 0;
        last24HoursCount += data.aggregations?.last_24h_count?.doc_count || 0;

        // Process error_messages (main message field), data.error, and data.message aggregations
        mergeAggregationBuckets(data.aggregations?.error_messages?.buckets, messageCountMap);
        mergeAggregationBuckets(data.aggregations?.data_error_messages?.buckets, messageCountMap);
        mergeAggregationBuckets(data.aggregations?.data_message_errors?.buckets, messageCountMap);
      }
    } catch (error) {
      console.error('Error fetching error summary from source:', sourceId, error);
    }
  }

  const errorGroups = Array.from(messageCountMap.entries())
    .map(([message, { count, lastSeen, event }]) => ({
      message,
      count,
      lastSeen: lastSeen || undefined,
      event: event || undefined
    }))
    .sort((a, b) => {
      // Sort by lastSeen descending (most recent first), then by count descending
      if (a.lastSeen && b.lastSeen) {
        const timeDiff = new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
        if (timeDiff !== 0) return timeDiff;
      } else if (a.lastSeen && !b.lastSeen) {
        return -1; // a has lastSeen, b doesn't - a comes first
      } else if (!a.lastSeen && b.lastSeen) {
        return 1; // b has lastSeen, a doesn't - b comes first
      }
      return b.count - a.count; // Fall back to count sorting
    })
    .slice(0, 10);

  return {
    total: totalErrors,
    last24Hours: last24HoursCount,
    errorGroups
  };
}

async function fetchLifetimeStats(
  appId: string,
  sourceIds: string[]
): Promise<LifetimeActivityStats> {
  const sources = getAllLogSources();
  let lastActivity: string | undefined;

  for (const sourceId of sourceIds) {
    const sourceConfig = sources.find((s) => s.id === sourceId);
    if (!sourceConfig || !sourceConfig.apiKey) continue;

    const { fieldMapping } = sourceConfig;

    const mustClauses: Record<string, unknown>[] = [];
    const appIdQuery = buildAppIdQuery(appId, fieldMapping);
    if (appIdQuery) {
      mustClauses.push(appIdQuery);
    }

    try {
      const esQuery = {
        size: 0,
        query: mustClauses.length > 0 ? {
          bool: {
            must: mustClauses
          }
        } : { match_all: {} },
        aggs: {
          last_activity: {
            max: {
              field: fieldMapping.timestampField
            }
          }
        }
      };

      const response = await fetch(
        `${sourceConfig.endpoint}/${sourceConfig.index}/_search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `ApiKey ${sourceConfig.apiKey}`
          },
          body: JSON.stringify(esQuery)
        }
      );

      if (response.ok) {
        const data = await response.json();
        const sourceLastActivity = data.aggregations?.last_activity?.value_as_string;

        if (sourceLastActivity) {
          if (!lastActivity || new Date(sourceLastActivity) > new Date(lastActivity)) {
            lastActivity = sourceLastActivity;
          }
        }
      }
    } catch (error) {
      console.error('Error fetching lifetime stats from source:', sourceId, error);
    }
  }

  return { lastActivity };
}

const BILLING_SID_PREFIX = 'airo-build:sid:';

/** Sentinel value: care-agent subscriptions are not real billing subscriptions */
const CARE_AGENT_SID = 'airo-builder:care-agent';

/** Normalize a subscriptionId to the billing sid format used in llm_spend_enduser_daily */
function toBillingSid(raw: string): string {
  if (!raw) return raw;
  return raw.startsWith(BILLING_SID_PREFIX) ? raw : `${BILLING_SID_PREFIX}${raw}`;
}

/** Returns true if the subscriptionId is a real billing subscription (not care-agent) */
function isValidBillingSid(sid: unknown): sid is string {
  return typeof sid === 'string' && sid.length > 0 && sid !== CARE_AGENT_SID;
}

/** Execute a single-doc ES search against a log source. Returns the _source of the first hit or null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryESFirst(
  endpoint: string,
  index: string,
  apiKey: string,
  mustClauses: Array<Record<string, unknown>>,
  sourceFields: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await fetch(
    `${endpoint}/${index}/_search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `ApiKey ${apiKey}`
      },
      body: JSON.stringify({
        size: 1,
        sort: [{ '@timestamp': { order: 'desc' } }],
        query: { bool: { must: mustClauses } },
        _source: sourceFields
      })
    }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.hits?.hits?.[0]?._source ?? null;
}

async function fetchSubscriptionInfo(
  appId: string
): Promise<{ subscriptionId?: string }> {
  const sources = getAllLogSources();
  const pioneerSource = sources.find(s => s.id === 'airo-agents');

  if (pioneerSource?.apiKey && pioneerSource?.endpoint && pioneerSource?.index) {
    const appIdQuery = buildAppIdQuery(appId, pioneerSource.fieldMapping);
    const mustBase = appIdQuery ? [appIdQuery] : [];

    // Strategy 1: event=summarization.detailed_llm.app_lookup
    try {
      const hit = await queryESFirst(
        pioneerSource.endpoint, pioneerSource.index, pioneerSource.apiKey,
        [...mustBase, { match: { event: 'summarization.detailed_llm.app_lookup' } }, { exists: { field: 'data.subscriptionId' } }],
        ['data.subscriptionId']
      );
      if (isValidBillingSid(hit?.data?.subscriptionId)) {
        return { subscriptionId: toBillingSid(hit.data.subscriptionId as string) };
      }
    } catch (error) {
      console.error('[app-context] subscription.strategy1.error', { appId, error: error instanceof Error ? error.message : String(error) });
    }

    // Strategy 2: Any Pioneer event with data.subscriptionId for this app
    try {
      const hit = await queryESFirst(
        pioneerSource.endpoint, pioneerSource.index, pioneerSource.apiKey,
        [...mustBase, { exists: { field: 'data.subscriptionId' } }],
        ['data.subscriptionId']
      );
      if (isValidBillingSid(hit?.data?.subscriptionId)) {
        return { subscriptionId: toBillingSid(hit.data.subscriptionId as string) };
      }
    } catch (error) {
      console.error('[app-context] subscription.strategy2.error', { appId, error: error instanceof Error ? error.message : String(error) });
    }

    // Strategy 3: Top-level subscriptionId field (context metadata)
    try {
      const hit = await queryESFirst(
        pioneerSource.endpoint, pioneerSource.index, pioneerSource.apiKey,
        [...mustBase, { exists: { field: 'subscriptionId' } }],
        ['subscriptionId']
      );
      const sid = hit?.subscriptionId;
      if (isValidBillingSid(sid)) {
        return { subscriptionId: toBillingSid(sid) };
      }
    } catch (error) {
      console.error('[app-context] subscription.strategy3.error', { appId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Strategy 4: Check airo-app (builder client) logs for subscriptionId
  const appSource = sources.find(s => s.id === 'airo-app');
  if (appSource?.apiKey && appSource?.endpoint && appSource?.index) {
    try {
      const hit = await queryESFirst(
        appSource.endpoint, appSource.index, appSource.apiKey,
        [{ term: { 'data.appId': appId } }, { exists: { field: 'data.subscriptionId' } }],
        ['data.subscriptionId']
      );
      const sid = hit?.data?.subscriptionId;
      if (isValidBillingSid(sid)) {
        return { subscriptionId: toBillingSid(sid as string) };
      }
    } catch (error) {
      console.error('[app-context] subscription.strategy4.error', { appId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {};
}

async function fetchAPMTraces(
  appId: string,
  timeRange: string = '24h',
  traceIdsPage: number = 0,
  traceIdsPageSize: number = 100,
  spansPage: number = 0,
  spansPageSize: number = 100,
  customStartTime?: string,
  customEndTime?: string
): Promise<APMTracesResult> {
  const endpoint = process.env.AIRO_BUILDER_ES_ENDPOINT;
  const apiKey = process.env.AIRO_BUILDER_ES_API_KEY;

  if (!endpoint || !apiKey) {
    return {
      traces: [],
      pagination: {
        hasMore: false,
        total: 0,
        page: spansPage,
        pageSize: spansPageSize
      }
    };
  }

  try {
    const { startTime, endTime } = parseTimeRange(timeRange, { customStartTime, customEndTime });

    // Step 1: Get trace IDs from transactions using Elasticsearch Query DSL
    const searchUrl = endpoint.endsWith('/')
      ? `${endpoint}traces-apm*/_search`
      : `${endpoint}/traces-apm*/_search`;

    const traceIdsQuery = {
      query: {
        bool: {
          must: [
            {
              term: {
                'processor.event': 'transaction'
              }
            },
            {
              term: {
                'labels.app_id': appId
              }
            },
            {
              range: {
                '@timestamp': {
                  gte: startTime.toISOString(),
                  lte: endTime.toISOString()
                }
              }
            }
          ]
        }
      },
      size: traceIdsPageSize,
      from: traceIdsPage * traceIdsPageSize,
      _source: ['trace.id']
    };

    const traceIdsResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `ApiKey ${apiKey}`
      },
      body: JSON.stringify(traceIdsQuery)
    });

    if (!traceIdsResponse.ok) {
      const errorText = await traceIdsResponse.text();
      console.error(
        `Error fetching trace IDs: ${traceIdsResponse.status} ${traceIdsResponse.statusText}`,
        errorText
      );
      console.error('Query that failed (trace IDs):', JSON.stringify(traceIdsQuery, null, 2));
      return {
        traces: [],
        pagination: {
          hasMore: false,
          total: 0,
          page: spansPage,
          pageSize: spansPageSize
        }
      };
    }

    const traceIdsData = await traceIdsResponse.json();
    const traceIds: string[] = [];
    const seenTraceIds = new Set<string>();
    const totalTraceIds = traceIdsData.hits?.total?.value ?? 0;
    const hasMoreTraceIds = (traceIdsPage + 1) * traceIdsPageSize < totalTraceIds;

    if (traceIdsData.hits?.hits && Array.isArray(traceIdsData.hits.hits)) {
      traceIdsData.hits.hits.forEach((hit: { _source: { 'trace.id'?: string; trace?: { id?: string } } }) => {
        const traceId = hit._source['trace.id'] || hit._source.trace?.id;
        if (typeof traceId === 'string' && traceId && !seenTraceIds.has(traceId)) {
          traceIds.push(traceId);
          seenTraceIds.add(traceId);
        }
      });
    }

    if (traceIds.length === 0) {
      return {
        traces: [],
        pagination: {
          hasMore: false,
          total: 0,
          page: spansPage,
          pageSize: spansPageSize
        }
      };
    }

    // Step 2: Get spans for those trace IDs
    console.log(`Found ${traceIds.length} distinct trace IDs for app ${appId}: ${traceIds.join(', ')}`);

    const spansQuery = {
      query: {
        bool: {
          must: [
            {
              term: {
                'processor.event': 'span'
              }
            },
            {
              "prefix": {
                "labels.operation_name": "ai"
              }
            },
            {
              terms: {
                'trace.id': traceIds
              }
            }
          ]
        }
      },

      sort: [
        {
          '@timestamp': {
            order: 'desc'
          }
        }
      ],
      size: spansPageSize,
      from: spansPage * spansPageSize
    };

    const spansResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `ApiKey ${apiKey}`
      },
      body: JSON.stringify(spansQuery)
    });

    if (!spansResponse.ok) {
      const errorText = await spansResponse.text();
      console.error(
        `Error fetching APM spans: ${spansResponse.status} ${spansResponse.statusText}`,
        errorText
      );
      console.error('Query that failed (spans):', JSON.stringify(spansQuery, null, 2));
      return {
        traces: [],
        pagination: {
          hasMore: false,
          total: 0,
          page: spansPage,
          pageSize: spansPageSize
        }
      };
    }

    const spansData = await spansResponse.json();
    const traces: APMTrace[] = [];
    const totalSpans = spansData.hits?.total?.value ?? 0;
    const hasMoreSpans = (spansPage + 1) * spansPageSize < totalSpans;

    if (spansData.hits?.hits && Array.isArray(spansData.hits.hits)) {
      spansData.hits.hits.forEach((hit: { _source: APMTrace }) => {
        traces.push(hit._source);
      });
    }

    const sortedTraces = traces.sort(
      (a, b) =>
        new Date(b['@timestamp']).getTime() -
        new Date(a['@timestamp']).getTime()
    );

    return {
      traces: sortedTraces,
      pagination: {
        hasMore: hasMoreSpans || hasMoreTraceIds,
        total: totalSpans,
        page: spansPage,
        pageSize: spansPageSize
      }
    };
  } catch (error) {
    console.error('Error fetching APM traces:', error);
    return {
      traces: [],
      pagination: {
        hasMore: false,
        total: 0,
        page: spansPage,
        pageSize: spansPageSize
      }
    };
  }
}

export const GET = withAuth(async (request, _auth) => {
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');
    const startTimeParam = searchParams.get('startTime');
    const endTimeParam = searchParams.get('endTime');
    let timeRange = searchParams.get('timeRange') || '24h';

    // If custom start/end times are provided, calculate timeRange from them
    if (startTimeParam && endTimeParam) {
      const start = new Date(startTimeParam);
      const end = new Date(endTimeParam);
      const diffMs = end.getTime() - start.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays >= 14) {
        timeRange = '14d';
      } else if (diffDays >= 7) {
        timeRange = '7d';
      } else if (diffHours >= 24) {
        timeRange = '24h';
      } else if (diffHours >= 6) {
        timeRange = '6h';
      } else if (diffHours >= 1) {
        timeRange = '1h';
      } else {
        timeRange = '15m';
      }
    }

    const sourcesParam = searchParams.get('sources');
    const traceIdsPage = parseInt(searchParams.get('traceIdsPage') || '0', 10);
    const traceIdsPageSize = parseInt(searchParams.get('traceIdsPageSize') || '100', 10);
    const spansPage = parseInt(searchParams.get('spansPage') || '0', 10);
    const spansPageSize = parseInt(searchParams.get('spansPageSize') || '100', 10);

    if (!appId) {
      return NextResponse.json(
        { error: 'appId query parameter is required' },
        { status: 400 }
      );
    }

    const sourceIds = sourcesParam
      ? sourcesParam.split(',')
      : ['airo-agents', 'control-plane'];

    const customStartTime = startTimeParam || undefined;
    const customEndTime = endTimeParam || undefined;

    const [logs, apmTracesResult, lifetimeStats, errorSummary, subscriptionInfo] = await Promise.all([
      fetchLogsForApp(appId, sourceIds, timeRange, customStartTime, customEndTime),
      fetchAPMTraces(appId, timeRange, traceIdsPage, traceIdsPageSize, spansPage, spansPageSize, customStartTime, customEndTime),
      fetchLifetimeStats(appId, sourceIds),
      fetchErrorSummary(appId, sourceIds, timeRange),
      fetchSubscriptionInfo(appId)
    ]);

    if (logs.length === 0) {
      return NextResponse.json({
        appId,
        metadata: {
          name: appId,
          lastActivity: lifetimeStats.lastActivity || null
        },
        recentActivity: [],
        errorSummary: {
          total: 0,
          last24Hours: 0,
          errorGroups: []
        },
        activityStats: {
          totalLogs: 0,
          byLevel: {},
          byService: {},
          byEvent: {}
        },
        lifetimeStats,
        conversations: [],
        apmTraces: {
          total: 0,
          traces: [],
          pagination: {
            hasMore: false,
            total: 0,
            page: 0,
            pageSize: spansPageSize
          }
        }
      });
    }

    const levelCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    const eventCounts: Record<string, number> = {};

    logs.forEach((log) => {
      let level = log._source.level || '';
      if (!level) {
        const rawLog = (log._source as Record<string, unknown>).log as string | undefined;
        if (rawLog) {
          const m = rawLog.match(/\]\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s+/i);
          level = m ? m[1].toLowerCase() : 'unknown';
        } else {
          level = 'unknown';
        }
      }
      levelCounts[level] = (levelCounts[level] || 0) + 1;

      if (log._source.service) {
        serviceCounts[log._source.service] =
          (serviceCounts[log._source.service] || 0) + 1;
      }

      if (log._source.event) {
        eventCounts[log._source.event] =
          (eventCounts[log._source.event] || 0) + 1;
      }
    });

    const conversationMap = new Map<
      string,
      { lastActivity: Date; eventCount: number }
    >();

    logs.forEach((log) => {
      const convId =
        log._source.conversationId || log._source.threadId || 'unknown';
      const timestamp = new Date(log._source['@timestamp']);
      const existing = conversationMap.get(convId);

      if (!existing || timestamp > existing.lastActivity) {
        conversationMap.set(convId, {
          lastActivity: timestamp,
          eventCount: (existing?.eventCount || 0) + 1
        });
      } else {
        existing.eventCount++;
      }
    });

    const conversations = Array.from(conversationMap.entries())
      .map(([conversationId, data]) => ({
        conversationId,
        lastActivity: data.lastActivity.toISOString(),
        eventCount: data.eventCount
      }))
      .sort(
        (a, b) =>
          new Date(b.lastActivity).getTime() -
          new Date(a.lastActivity).getTime()
      )
      .slice(0, 10);

    const recentActivity = logs.slice(0, 50).map((log) => {
      const fieldMapping = log._fieldMapping;
      const rawLog = (log._source as Record<string, unknown>).log as string | undefined;

      // Extract values using field mapping if available
      let level = fieldMapping
        ? String(getNestedValue(log._source, fieldMapping.levelField) || '')
        : (log._source.level || '');

      let message = fieldMapping
        ? String(
          getNestedValue(log._source, 'data.message') ||
          getNestedValue(log._source, fieldMapping.messageField) ||
          getNestedValue(log._source, fieldMapping.eventField) ||
          ''
        )
        : (log._source.data?.message || log._source.message || log._source.event || '');

      // For unstructured logs, parse level and use raw log text as message
      if (!level && rawLog) {
        const levelMatch = rawLog.match(/\]\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s+/i);
        level = levelMatch ? levelMatch[1].toLowerCase() : '';
      }
      if (!message && rawLog) {
        message = rawLog;
      }

      const event = fieldMapping
        ? String(getNestedValue(log._source, fieldMapping.eventField) || '')
        : log._source.event;

      const service = fieldMapping
        ? String(getNestedValue(log._source, fieldMapping.serviceField) || '')
        : log._source.service;

      return {
        id: log._id,
        timestamp: log._source['@timestamp'],
        level: level || 'unknown',
        message,
        event: event || undefined,
        service: service || undefined,
        source: log._sourceId,
        raw: log._source
      };
    });

    const lastActivityLog = logs[0];

    // Fallback: scan fetched logs for subscriptionId if dedicated queries didn't find it
    if (!subscriptionInfo.subscriptionId) {
      for (const log of logs) {
        const src = log._source;
        const sid = (src as Record<string, unknown>).subscriptionId
          || (src.data as Record<string, unknown> | undefined)?.subscriptionId;
        if (isValidBillingSid(sid)) {
          subscriptionInfo.subscriptionId = toBillingSid(sid);
          break;
        }
      }
    }

    const formattedTraces = apmTracesResult.traces.map((trace) => ({
      timestamp: trace['@timestamp'],
      spanName: trace.span?.name,
      duration: trace.span?.duration?.us
        ? trace.span.duration.us / 1000
        : undefined,
      raw: trace
    }));

    const context: AppContext = {
      appId,
      metadata: {
        name: appId,
        lastActivity: lastActivityLog?._source['@timestamp'],
        version: lastActivityLog?._source.version,
        status: 'active',
        subscriptionId: subscriptionInfo.subscriptionId,
      },
      recentActivity,
      errorSummary,
      activityStats: {
        totalLogs: logs.length,
        byLevel: levelCounts,
        byService: serviceCounts,
        byEvent: eventCounts
      },
      lifetimeStats,
      conversations,
      apmTraces: {
        total: apmTracesResult.pagination.total,
        traces: formattedTraces,
        pagination: apmTracesResult.pagination
      }
    };

    return NextResponse.json(context, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch app context',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        }
      }
    );
  }
});
