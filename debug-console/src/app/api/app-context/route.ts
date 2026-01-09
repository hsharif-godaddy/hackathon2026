import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getAllLogSources } from '@/lib/log-sources';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

interface AppContext {
  appId: string;
  metadata: {
    name?: string;
    status?: string;
    template?: string;
    version?: string;
    createdAt?: string;
    lastActivity?: string;
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
    lastError?: {
      timestamp: string;
      message: string;
      event?: string;
    };
    commonErrors: Array<{
      message: string;
      count: number;
    }>;
  };
  activityStats: {
    totalLogs: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byEvent: Record<string, number>;
  };
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

interface LogEntryWithSource extends LogEntry {
  _sourceId?: string;
}

async function fetchLogsForApp(
  appId: string,
  sourceIds: string[],
  timeRange: string = '24h',
  customStartTime?: string,
  customEndTime?: string
): Promise<LogEntryWithSource[]> {
  const allLogs: LogEntryWithSource[] = [];
  const sources = getAllLogSources();

  let startTime: Date;
  let endTime: Date = new Date();

  if (customStartTime && customEndTime) {
    startTime = new Date(customStartTime);
    endTime = new Date(customEndTime);
  } else {
    const now = new Date();
    const value = parseInt(timeRange.slice(0, -1), 10);
    const unit = timeRange.slice(-1);
    startTime = new Date(now);

    switch (unit) {
      case 'm':
        startTime.setMinutes(startTime.getMinutes() - value);
        break;
      case 'h':
        startTime.setHours(startTime.getHours() - value);
        break;
      case 'd':
        startTime.setDate(startTime.getDate() - value);
        break;
    }
  }

  for (const sourceId of sourceIds) {
    const sourceConfig = sources.find((s) => s.id === sourceId);
    if (!sourceConfig || !sourceConfig.apiKey) continue;

    try {
      const esQuery = {
        size: 1000,
        from: 0,
        sort: [{ '@timestamp': { order: 'desc' } }],
        query: {
          bool: {
            must: [
              { match: { app_id: appId } },
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
          _sourceId: sourceId
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
    let startTime: Date;
    let endTime: Date = new Date();

    if (customStartTime && customEndTime) {
      startTime = new Date(customStartTime);
      endTime = new Date(customEndTime);
    } else {
      const now = new Date();
      const value = parseInt(timeRange.slice(0, -1), 10);
      const unit = timeRange.slice(-1);
      startTime = new Date(now);

      switch (unit) {
        case 'm':
          startTime.setMinutes(startTime.getMinutes() - value);
          break;
        case 'h':
          startTime.setHours(startTime.getHours() - value);
          break;
        case 'd':
          startTime.setDate(startTime.getDate() - value);
          break;
      }
    }

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
    const totalTraceIds = traceIdsData.hits?.total?.value || traceIdsData.hits?.total || 0;
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
    const totalSpans = spansData.hits?.total?.value || spansData.hits?.total || 0;
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

export const GET = withAuth(async (request) => {
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

      if (diffDays >= 7) {
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
      : ['airo-agents', 'airo-app'];

    const customStartTime = startTimeParam || undefined;
    const customEndTime = endTimeParam || undefined;

    const [logs, apmTracesResult] = await Promise.all([
      fetchLogsForApp(appId, sourceIds, timeRange, customStartTime, customEndTime),
      fetchAPMTraces(appId, timeRange, traceIdsPage, traceIdsPageSize, spansPage, spansPageSize, customStartTime, customEndTime)
    ]);

    if (logs.length === 0) {
      return NextResponse.json({
        appId,
        metadata: {
          name: appId,
          lastActivity: null
        },
        recentActivity: [],
        errorSummary: {
          total: 0,
          last24Hours: 0,
          commonErrors: []
        },
        activityStats: {
          totalLogs: 0,
          byLevel: {},
          byService: {},
          byEvent: {}
        },
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

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const errors = logs.filter(
      (log) => log._source.level?.toUpperCase() === 'ERROR'
    );
    const errorsLast24h = errors.filter(
      (log) => new Date(log._source['@timestamp']) >= last24Hours
    );

    const errorMessages = new Map<string, number>();
    errors.forEach((log) => {
      const message =
        (log._source.data as any)?.message ||
        log._source.message ||
        log._source.event ||
        'Unknown error';
      errorMessages.set(message, (errorMessages.get(message) || 0) + 1);
    });

    const commonErrors = Array.from(errorMessages.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const levelCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    const eventCounts: Record<string, number> = {};

    logs.forEach((log) => {
      const level = log._source.level || 'UNKNOWN';
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

    const lastError =
      errors.length > 0
        ? {
          timestamp: errors[0]._source['@timestamp'],
          message:
            (errors[0]._source.data as any)?.message ||
            errors[0]._source.message ||
            errors[0]._source.event ||
            'Unknown error',
          event: errors[0]._source.event
        }
        : undefined;

    const recentActivity = logs.slice(0, 50).map((log) => ({
      id: log._id,
      timestamp: log._source['@timestamp'],
      level: log._source.level || 'INFO',
      message:
        (log._source.data as any)?.message ||
        log._source.message ||
        log._source.event ||
        '',
      event: log._source.event,
      service: log._source.service,
      source: (log as LogEntryWithSource)._sourceId,
      raw: log._source
    }));

    const lastActivityLog = logs[0];
    const firstActivityLog = logs[logs.length - 1];

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
        status: 'active'
      },
      recentActivity,
      errorSummary: {
        total: errors.length,
        last24Hours: errorsLast24h.length,
        lastError,
        commonErrors
      },
      activityStats: {
        totalLogs: logs.length,
        byLevel: levelCounts,
        byService: serviceCounts,
        byEvent: eventCounts
      },
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
