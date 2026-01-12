import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdQuery, getAllLogSources, getNestedValue } from '@/lib/log-sources';
import type { FieldMapping } from '@/lib/log-sources';

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

interface ActivityLog {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  service?: string;
  source?: string;
  raw: Record<string, unknown>;
}

interface ActivityLogsResponse {
  logs: ActivityLog[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

interface LogEntryWithFieldMapping extends LogEntry {
  _sourceId: string;
  _fieldMapping: FieldMapping;
}

async function fetchActivityLogs(
  appId: string,
  sourceIds: string[],
  page: number,
  pageSize: number,
  timeRange: string = '24h',
  customStartTime?: string,
  customEndTime?: string
): Promise<ActivityLogsResponse> {
  const sources = getAllLogSources();
  const allLogs: LogEntryWithFieldMapping[] = [];
  let totalCount = 0;

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
        size: pageSize,
        from: page * pageSize,
        sort: [{ [fieldMapping.timestampField]: { order: 'desc' } }],
        track_total_hits: true,
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
        totalCount += data.hits.total.value;
        const logsWithSource = data.hits.hits.map((log) => ({
          ...log,
          _sourceId: sourceId,
          _fieldMapping: fieldMapping
        }));
        allLogs.push(...logsWithSource);
      }
    } catch (error) {
      console.error('Error fetching activity logs from source:', sourceId, error);
    }
  }

  // Sort combined logs by timestamp descending
  allLogs.sort(
    (a, b) =>
      new Date(b._source['@timestamp']).getTime() -
      new Date(a._source['@timestamp']).getTime()
  );

  // Take only pageSize items (since we fetched pageSize from each source)
  const paginatedLogs = allLogs.slice(0, pageSize);

  const formattedLogs: ActivityLog[] = paginatedLogs.map((log) => {
    const { _fieldMapping } = log;

    // Extract values using field mapping
    const level = String(getNestedValue(log._source, _fieldMapping.levelField) || 'INFO');
    const message = String(
      getNestedValue(log._source, 'data.message') ||
      getNestedValue(log._source, _fieldMapping.messageField) ||
      getNestedValue(log._source, _fieldMapping.eventField) ||
      ''
    );
    const event = String(getNestedValue(log._source, _fieldMapping.eventField) || '');
    const service = String(getNestedValue(log._source, _fieldMapping.serviceField) || '');

    return {
      id: log._id,
      timestamp: log._source['@timestamp'],
      level,
      message,
      event: event || undefined,
      service: service || undefined,
      source: log._sourceId,
      raw: log._source
    };
  });

  return {
    logs: formattedLogs,
    pagination: {
      page,
      pageSize,
      total: totalCount,
      hasMore: (page + 1) * pageSize < totalCount
    }
  };
}

export const GET = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const startTimeParam = searchParams.get('startTime');
    const endTimeParam = searchParams.get('endTime');
    let timeRange = searchParams.get('timeRange') || '24h';

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

    if (!appId) {
      return NextResponse.json(
        { error: 'appId query parameter is required' },
        { status: 400 }
      );
    }

    const sourceIds = sourcesParam
      ? sourcesParam.split(',')
      : ['airo-agents', 'control_plane'];

    const result = await fetchActivityLogs(
      appId,
      sourceIds,
      page,
      pageSize,
      timeRange,
      startTimeParam || undefined,
      endTimeParam || undefined
    );

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch activity logs',
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
