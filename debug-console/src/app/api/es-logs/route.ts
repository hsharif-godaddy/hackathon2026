import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdQuery, getLogSourceConfig, getNestedValue } from '@/lib/log-sources';

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
    logger?: string;
    thread?: string;
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

export const GET = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('source') || 'airo-agents';
    const size = parseInt(searchParams.get('size') || '100', 10);
    const from = parseInt(searchParams.get('from') || '0', 10);
    const level = searchParams.get('level');
    const levels = searchParams.get('levels');
    const query = searchParams.get('query');
    const appId = searchParams.get('appId');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');

    const sourceConfig = getLogSourceConfig(sourceId);

    if (!sourceConfig) {
      return NextResponse.json(
        { error: `Unknown log source: ${sourceId}` },
        { status: 400 }
      );
    }

    if (!sourceConfig.apiKey) {
      return NextResponse.json({
        logs: [],
        total: 0,
        size: 0,
        from: 0,
        warning: `Elasticsearch API key not configured for source: ${sourceId}`
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        }
      });
    }

    const mustClauses: Array<Record<string, unknown>> = [];
    const levelKeywordField = sourceConfig.fieldMapping.levelKeywordField;

    if (levels) {
      const levelList = levels.split(',').map(l => sourceConfig.fieldMapping.logLevelFieldMap?.[l.trim().toLowerCase()] || l.trim().toUpperCase());
      mustClauses.push({
        terms: { [levelKeywordField]: levelList }
      });
    } else if (level && level !== 'all') {
      const mappedLevel = sourceConfig.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();
      mustClauses.push({
        term: { [levelKeywordField]: mappedLevel }
      });
    }

    if (query) {
      mustClauses.push({
        multi_match: {
          query,
          fields: ['message^2', 'event', 'logger', 'service', 'app_id', 'appId', 'customerId', 'customer.id', 'hostname', 'environment', 'region', 'version', 'data.message'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    }

    // Only apply app ID filter if the source supports it
    if (appId && sourceConfig.fieldMapping.appIdField) {
      const appIdQuery = buildAppIdQuery(appId, sourceConfig.fieldMapping);
      if (appIdQuery) {
        mustClauses.push(appIdQuery);
      }
    }

    if (startTime) {
      mustClauses.push({
        range: {
          '@timestamp': {
            gte: startTime,
            ...(endTime ? { lte: endTime } : {})
          }
        }
      });
    }

    const esQuery = {
      size,
      from,
      sort: [
        { '@timestamp': { order: 'desc' } }
      ],
      query: {
        bool: {
          must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }]
        }
      }
    };

    const response = await fetch(
      `${sourceConfig.endpoint}/${sourceConfig.index}/_search?ignore_unavailable=true&expand_wildcards=open`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ApiKey ${sourceConfig.apiKey}`
        },
        body: JSON.stringify(esQuery)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 404) {
        console.warn(`[es-logs] Index not found for source: ${sourceId}`, {
          endpoint: sourceConfig.endpoint,
          index: sourceConfig.index
        });
        return NextResponse.json({
          logs: [],
          total: 0,
          size,
          from,
          warning: `Elasticsearch index not found for source: ${sourceId}`,
          data: {
            endpoint: sourceConfig.endpoint,
            index: sourceConfig.index,
          }
        }, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
          }
        });
      }

      console.error(`[es-logs] Elasticsearch error for source: ${sourceId}`, {
        status: response.status,
        endpoint: sourceConfig.endpoint,
        index: sourceConfig.index,
        error: errorText.slice(0, 500)
      });

      return NextResponse.json(
        { error: 'Failed to fetch logs from Elasticsearch', details: errorText },
        {
          status: response.status,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
          }
        }
      );
    }

    const data: ESSearchResponse = await response.json();

    const { fieldMapping } = sourceConfig;
    const logs = data.hits.hits.map((hit) => {
      const src = hit._source as Record<string, unknown>;
      return {
        id: hit._id,
        timestamp: getNestedValue(src, fieldMapping.timestampField) as string,
        level: (getNestedValue(src, fieldMapping.levelField) as string) || 'INFO',
        message: (getNestedValue(src, fieldMapping.messageField) as string) || '',
        event: getNestedValue(src, fieldMapping.eventField) as string | undefined,
        appId: fieldMapping.appIdField ? getNestedValue(src, fieldMapping.appIdField) as string : undefined,
        logger: src.logger as string | undefined,
        service: getNestedValue(src, fieldMapping.serviceField) as string | undefined,
        hostname: src.hostname as string | undefined,
        environment: src.environment as string | undefined,
        region: src.region as string | undefined,
        version: src.version as string | undefined,
        data: src.data as Record<string, unknown> | undefined,
        raw: src
      };
    });

    return NextResponse.json({
      logs,
      total: data.hits.total.value,
      size,
      from,
      source: sourceId
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    console.error('[es-logs] Unexpected error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error: 'Failed to fetch logs',
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
