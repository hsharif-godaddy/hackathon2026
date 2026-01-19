import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdQuery, getLogSourceConfig } from '@/lib/log-sources';

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

    if (levels) {
      const levelList = levels.split(',').map(l => l.toLowerCase());
      mustClauses.push({
        terms: { level: levelList }
      });
    } else if (level && level !== 'all') {
      mustClauses.push({
        match: { level: level.toLowerCase() }
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

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 404) {
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

    const logs = data.hits.hits.map((hit) => ({
      id: hit._id,
      timestamp: hit._source['@timestamp'],
      level: hit._source.level || 'INFO',
      message: hit._source.message || '',
      event: hit._source.event,
      appId: hit._source.app_id,
      logger: hit._source.logger,
      service: hit._source.service,
      hostname: hit._source.hostname,
      environment: hit._source.environment,
      region: hit._source.region,
      version: hit._source.version,
      data: hit._source.data,
      raw: hit._source
    }));

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
