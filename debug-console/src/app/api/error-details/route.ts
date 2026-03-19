import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdQuery, getAllLogSources } from '@/lib/log-sources';
import { parseTimeRange } from '@/lib/time-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ErrorDetail {
  timestamp: string;
  message: string;
  event?: string;
  service?: string;
  raw: Record<string, unknown>;
}

export const GET = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');
    const message = searchParams.get('message');
    const timeRange = searchParams.get('timeRange') || '24h';

    if (!appId) {
      return NextResponse.json(
        { error: 'appId query parameter is required' },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: 'message query parameter is required' },
        { status: 400 }
      );
    }

    const sources = getAllLogSources();
    const sourceIds = ['airo-agents', 'control-plane'];

    const { startTime, endTime } = parseTimeRange(timeRange);

    const allErrors: ErrorDetail[] = [];

    for (const sourceId of sourceIds) {
      const sourceConfig = sources.find((s) => s.id === sourceId);
      if (!sourceConfig?.apiKey) {continue;}

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
        },
        {
          bool: {
            should: [
              { match_phrase: { [fieldMapping.messageField]: message } },
              { match_phrase: { 'data.message': message } },
              { match_phrase: { 'data.error': message } }
            ],
            minimum_should_match: 1
          }
        }
      ];

      const appIdQuery = buildAppIdQuery(appId, fieldMapping);
      if (appIdQuery) {
        mustClauses.push(appIdQuery);
      }

      try {
        const esQuery = {
          size: 20,
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
          const data = await response.json();

          if (data.hits?.hits) {
            for (const hit of data.hits.hits) {
              const source = hit._source;
              allErrors.push({
                timestamp: source['@timestamp'] || source[fieldMapping.timestampField],
                message: source.data?.message || source.message || 'Unknown error',
                event: source.event,
                service: source.service || source['service.name'],
                raw: source
              });
            }
          }
        }
      } catch (error) {
        console.error('Error fetching error details from source:', sourceId, error);
      }
    }

    const sortedErrors = allErrors
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);

    return NextResponse.json({
      errors: sortedErrors,
      total: sortedErrors.length
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch error details',
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
