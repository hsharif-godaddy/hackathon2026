import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { buildAppIdQuery, getLogSourceConfig, getNestedValue } from '@/lib/log-sources';
import type { LogSourceConfig } from '@/lib/log-sources';
import { buildLokiQuery, queryLoki, transformLokiResponse } from '@/lib/loki-client';

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

    // Route to appropriate backend based on config
    if (sourceConfig.backendType === 'loki') {
      return handleLokiQuery(sourceConfig, {
        sourceId,
        size,
        from,
        level,
        levels,
        query,
        appId,
        startTime,
        endTime
      });
    }

    // Default to Elasticsearch
    return handleElasticsearchQuery(sourceConfig, {
      sourceId,
      size,
      from,
      level,
      levels,
      query,
      appId,
      startTime,
      endTime
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

/**
 * Handle Loki log queries
 */
async function handleLokiQuery(
  sourceConfig: LogSourceConfig,
  params: {
    sourceId: string;
    size: number;
    from: number;
    level: string | null;
    levels: string | null;
    query: string | null;
    appId: string | null;
    startTime: string | null;
    endTime: string | null;
  }
) {
  try {
    // Build Loki query
    const lokiParams = await buildLokiQuery({
      levelFilter: params.level || undefined,
      levelsFilter: params.levels || undefined,
      query: params.query || undefined,
      appId: params.appId || undefined,
      startTime: params.startTime || undefined,
      endTime: params.endTime || undefined,
      size: params.size,
      from: params.from
    }, {
      lokiEndpoint: sourceConfig.lokiEndpoint,
      lokiApiKey: sourceConfig.lokiApiKey,
      lokiLabels: sourceConfig.lokiLabels,
      environment: sourceConfig.environment
    });

    // Query Loki
    const response = await queryLoki({
      lokiEndpoint: sourceConfig.lokiEndpoint,
      lokiApiKey: sourceConfig.lokiApiKey,
      lokiLabels: sourceConfig.lokiLabels,
      environment: sourceConfig.environment
    }, lokiParams);

    // Transform response
    const logs = transformLokiResponse(
      response,
      sourceConfig.fieldMapping,
      params.sourceId
    );

    // Handle pagination by slicing in memory (Loki doesn't have native offset)
    const paginatedLogs = logs.slice(params.from, params.from + params.size);

    // Check if results were truncated at the Loki limit (5000)
    const wasTruncated = logs.length >= 5000;

    return NextResponse.json({
      logs: paginatedLogs,
      total: logs.length, // Actual count of all logs fetched for this time range
      size: params.size,
      from: params.from,
      source: params.sourceId,
      ...(wasTruncated && {
        warning: 'Results limited to 5000 logs. Narrow your time range or filters to see all matching logs.',
        truncated: true
      })
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    console.error('[loki-logs] Error querying Loki:', error);
    return NextResponse.json({
      logs: [],
      total: 0,
      size: params.size,
      from: params.from,
      warning: `Loki unavailable for source: ${params.sourceId}`,
      details: error instanceof Error ? error.message : 'Unknown error'
    }, {
      status: 200,  // Return 200 with empty results (same as ES 404 handling)
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  }
}

/**
 * Handle Elasticsearch log queries
 */
async function handleElasticsearchQuery(
  sourceConfig: LogSourceConfig,
  params: {
    sourceId: string;
    size: number;
    from: number;
    level: string | null;
    levels: string | null;
    query: string | null;
    appId: string | null;
    startTime: string | null;
    endTime: string | null;
  }
) {
  if (!sourceConfig.apiKey) {
    return NextResponse.json({
      logs: [],
      total: 0,
      size: 0,
      from: 0,
      warning: `Elasticsearch API key not configured for source: ${params.sourceId}`
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  }

  try {
    const mustClauses: Array<Record<string, unknown>> = [];
    const levelKeywordField = sourceConfig.fieldMapping.levelKeywordField;

    if (params.levels) {
      const levelList = params.levels.split(',').map(l => sourceConfig.fieldMapping.logLevelFieldMap?.[l.trim().toLowerCase()] || l.trim().toUpperCase());
      const rawLevelPatterns = params.levels.split(',').map(l => l.trim().toUpperCase());
      // Level filtering for mixed structured/unstructured logs:
      // - Structured logs: match the indexed level keyword field (e.g. level.keyword = "INFO")
      // - Unstructured logs (no level field): fall back to match_phrase on raw `log` text
      //   (e.g. log contains "INFO"), but only when the structured field doesn't exist
      //   to avoid false positives from log message content
      mustClauses.push({
        bool: {
          should: [
            { terms: { [levelKeywordField]: levelList } },
            ...rawLevelPatterns.map(p => ({
              bool: {
                must: [
                  { match_phrase: { log: p } },
                  { bool: { must_not: [{ exists: { field: levelKeywordField } }] } }
                ]
              }
            }))
          ],
          minimum_should_match: 1
        }
      });
    } else if (params.level && params.level !== 'all') {
      const mappedLevel = sourceConfig.fieldMapping.logLevelFieldMap?.[params.level.toLowerCase()] || params.level.toUpperCase();
      // Same mixed-log level filtering as above, for single level value
      mustClauses.push({
        bool: {
          should: [
            { term: { [levelKeywordField]: mappedLevel } },
            {
              bool: {
                must: [
                  { match_phrase: { log: params.level.toUpperCase() } },
                  { bool: { must_not: [{ exists: { field: levelKeywordField } }] } }
                ]
              }
            }
          ],
          minimum_should_match: 1
        }
      });
    }

    if (params.query) {
      mustClauses.push({
        multi_match: {
          query: params.query,
          fields: ['message^2', 'log', 'event', 'logger', 'service', 'app_id', 'appId', 'customerId', 'customer.id', 'hostname', 'environment', 'region', 'version', 'data.message'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    }

    // Only apply app ID filter if the source supports it
    if (params.appId && sourceConfig.fieldMapping.appIdField) {
      const appIdQuery = buildAppIdQuery(params.appId, sourceConfig.fieldMapping);
      if (appIdQuery) {
        mustClauses.push(appIdQuery);
      }
    }

    if (params.startTime) {
      mustClauses.push({
        range: {
          '@timestamp': {
            gte: params.startTime,
            ...(params.endTime ? { lte: params.endTime } : {})
          }
        }
      });
    }

    const esQuery = {
      size: params.size,
      from: params.from,
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
        console.warn('[es-logs] Index not found for source:', params.sourceId, {
          endpoint: sourceConfig.endpoint,
          index: sourceConfig.index
        });
        return NextResponse.json({
          logs: [],
          total: 0,
          size: params.size,
          from: params.from,
          warning: `Elasticsearch index not found for source: ${params.sourceId}`,
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

      console.error('[es-logs] Elasticsearch error for source:', params.sourceId, {
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
      const rawLog = src.log as string | undefined;

      // For unstructured logs (only have `log` field), parse level and message from the text
      // Format: "[2026-03-03T11:03:48.609Z] INFO  [@airo/ai-lib] grants.session.updated {...}"
      let level = (getNestedValue(src, fieldMapping.levelField) as string) || '';
      let message = (getNestedValue(src, fieldMapping.messageField) as string) || '';

      if (!level && rawLog) {
        const levelMatch = rawLog.match(/\]\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s+/i);
        level = levelMatch ? levelMatch[1].toLowerCase() : '';
      }
      if (!message && rawLog) {
        message = rawLog;
      }

      return {
        id: hit._id,
        timestamp: getNestedValue(src, fieldMapping.timestampField) as string,
        level: level || 'unknown',
        message,
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
      size: params.size,
      from: params.from,
      source: params.sourceId
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
}
