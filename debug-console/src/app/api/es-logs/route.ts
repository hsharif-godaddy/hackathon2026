import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { resolveAppCluster } from '@/lib/investigate/evidence';
import { buildElasticsearchRequestBody } from '@/lib/es-query';
import { getLogSourceConfig, getNestedValue } from '@/lib/log-sources';
import type { LogSourceConfig } from '@/lib/log-sources';
import { buildLokiQuery, findMinTimestampNs, findMinTimestampNsRaw, queryLoki, transformLokiResponse } from '@/lib/loki-client';
import { queryMergedLokiSources } from '@/lib/loki-merged';
import { MERGED_LOKI_SOURCE_ID } from '@/lib/loki-source-ids';

// Default page size for Loki sources (single + merged). One round-trip per
// 50 logs, with a `nextCursor` (oldest timestamp_ns) returned so the client
// can paginate via Load More.
const LOKI_PAGE_SIZE = 50;

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

export const GET = withAuth(async (request, _auth) => {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('source') || 'airo-agents';
    const level = searchParams.get('level');
    const levels = searchParams.get('levels');
    const query = searchParams.get('query');
    const appId = searchParams.get('appId');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    // Opaque pagination cursor returned by a previous response under
    // `nextCursor`. Format is backend-specific:
    //   - Loki:   nanosecond timestamp string of the oldest log on the
    //             previous page; we shift Loki's exclusive `end` by -1ns
    //             to get strictly older results.
    //   - ES:     decimal string for the next `from` offset.
    // The client treats it as opaque; only the route knows how to interpret it.
    const cursor = searchParams.get('cursor');

    // Merged-streams optimization: one Loki query covers airo-agents +
    // airo-preview-application + airo-publish-application, with results
    // tagged per-log by the `job` stream label. Reduces 3 simultaneous
    // Loki requests to 1 and lets us scope by `cluster` when an appId is
    // provided (resolved from the agent URL).
    if (sourceId === MERGED_LOKI_SOURCE_ID) {
      return handleMergedLokiQuery({
        sourceId,
        level,
        levels,
        query,
        appId,
        startTime,
        endTime,
        cursor,
      });
    }

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
        level,
        levels,
        query,
        appId,
        startTime,
        endTime,
        cursor,
      });
    }

    // Default to Elasticsearch — uses native `from`/`size` pagination, with
    // `cursor` carrying the next `from` offset.
    const esSize = parseInt(searchParams.get('size') || '50', 10);
    const esFrom = cursor ? parseInt(cursor, 10) || 0 : parseInt(searchParams.get('from') || '0', 10);
    return handleElasticsearchQuery(sourceConfig, {
      sourceId,
      size: esSize,
      from: esFrom,
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

interface LokiQueryRequestParams {
  sourceId: string;
  level: string | null;
  levels: string | null;
  query: string | null;
  appId: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Opaque cursor (nanosecond timestamp string) from the previous response. */
  cursor: string | null;
}

/**
 * Build Loki labels with cluster narrowing when an appId is provided. The
 * cluster is parsed from the app's agent URL (`<appId>.<svc>.<cluster>.airoapp.ai`)
 * via the mgmt control plane. A failed lookup returns null and we fall back
 * to no cluster label rather than dropping logs — apps whose allocation is
 * mid-migration still surface results, just slower.
 */
async function resolveLokiLabels(
  baseLabels: Record<string, string> | undefined,
  appId: string | null
): Promise<Record<string, string>> {
  const labels = { ...(baseLabels || {}) };
  if (!appId) return labels;
  const cluster = await resolveAppCluster(appId);
  if (cluster) labels.cluster = cluster;
  return labels;
}

/**
 * Handle Loki log queries (single source).
 *
 * Loki has no native offset, so we paginate via time-cursor: each response
 * carries a `nextCursor` = the oldest log's `_loki_timestamp_ns`, which the
 * client passes back to fetch the next page. We override Loki's `end`
 * (exclusive) to `cursor - 1ns`, so the next page starts strictly before
 * the previously-seen oldest log. One round-trip per page, no client-side
 * slicing.
 */
async function handleLokiQuery(
  sourceConfig: LogSourceConfig,
  params: LokiQueryRequestParams
) {
  try {
    const lokiLabels = await resolveLokiLabels(sourceConfig.lokiLabels, params.appId);

    const config = {
      lokiEndpoint: sourceConfig.lokiEndpoint,
      lokiApiKey: sourceConfig.lokiApiKey,
      lokiLabels,
      environment: sourceConfig.environment
    };

    const lokiParams = await buildLokiQuery({
      levelFilter: params.level || undefined,
      levelsFilter: params.levels || undefined,
      query: params.query || undefined,
      appId: params.appId || undefined,
      startTime: params.startTime || undefined,
      endTime: params.endTime || undefined,
      size: LOKI_PAGE_SIZE,
    }, config);

    if (params.cursor) {
      // Cursor is the previous page's oldest timestamp_ns. Loki's `end` is
      // exclusive, but to be defensive against edge cases we shift by -1ns
      // so a backend that treats it as inclusive still excludes the boundary.
      try {
        lokiParams.end = (BigInt(params.cursor) - 1n).toString();
      } catch {
        // Malformed cursor — ignore and fall back to the user's endTime.
      }
    }

    const response = await queryLoki(config, lokiParams);

    const logs = transformLokiResponse(
      response,
      sourceConfig.fieldMapping,
      params.sourceId
    );

    // hasMore from raw input count (not parsed `logs.length`) so dropped
    // malformed entries don't make the page look "complete". Cursor uses
    // the parsed-logs min when available, falling back to the raw streams
    // when EVERY entry on a saturated page failed to parse — without the
    // fallback, an all-malformed page would leave us with no cursor to
    // advance past it and pagination dead-ends.
    const rawEntryCount = response.data.result.reduce((sum, s) => sum + s.values.length, 0);
    const hasMore = rawEntryCount >= LOKI_PAGE_SIZE;
    const nextCursor = hasMore
      ? (findMinTimestampNs(logs) ?? findMinTimestampNsRaw(response.data.result))
      : undefined;

    return NextResponse.json({
      logs,
      source: params.sourceId,
      ...(nextCursor && { nextCursor }),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    console.error('[loki-logs] Error querying Loki:', error);
    return NextResponse.json({
      logs: [],
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
 * Handle a merged Loki query covering airo-agents + airo-preview-application
 * + airo-publish-application in a single Loki request. Delegates to the
 * shared `queryMergedLokiSources` helper (also used by app-context).
 *
 * Time-cursor pagination via `params.cursor`: passes through to merged helper
 * (no override needed because cursor maps to a future-page request shape only
 * via the helper's own size/cursor support — implemented inline here by
 * shifting `endTime` to `cursor - 1ns` before delegating).
 */
async function handleMergedLokiQuery(params: LokiQueryRequestParams) {
  try {
    let endTimeNs: string | undefined;
    if (params.cursor) {
      try {
        // Cursor is the previous page's oldest timestamp_ns. Pass `cursor-1ns`
        // straight through as Loki's `end` (full ns precision) — the merged
        // helper override path bypasses the ISO→ms→ns conversion that would
        // otherwise truncate sub-ms precision and re-include boundary logs.
        endTimeNs = (BigInt(params.cursor) - 1n).toString();
      } catch {
        // Malformed cursor — fall back to the user's endTime.
      }
    }

    const { logs, nextCursor } = await queryMergedLokiSources({
      appId: params.appId || undefined,
      levelsFilter: params.levels || (params.level && params.level !== 'all' ? params.level : undefined) || undefined,
      query: params.query || undefined,
      startTime: params.startTime || undefined,
      endTime: params.endTime || undefined,
      endTimeNs,
      size: LOKI_PAGE_SIZE,
    });

    return NextResponse.json({
      logs,
      source: params.sourceId,
      ...(nextCursor && { nextCursor }),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    console.error('[loki-logs] Error querying merged Loki:', error);
    return NextResponse.json({
      logs: [],
      warning: `Loki unavailable for source: ${params.sourceId}`,
      details: error instanceof Error ? error.message : 'Unknown error'
    }, {
      status: 200,
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
    // Shared with the client-side ES preview renderer so the rendered query
    // and the actual server query stay in sync. See lib/es-query.ts.
    const esQuery = buildElasticsearchRequestBody({
      fieldMapping: sourceConfig.fieldMapping,
      size: params.size,
      from: params.from,
      level: params.level,
      levels: params.levels,
      query: params.query,
      appId: params.appId,
      startTime: params.startTime,
      endTime: params.endTime,
    });

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

    const total = data.hits.total.value;
    const nextFrom = params.from + logs.length;
    const nextCursor = nextFrom < total && logs.length > 0 ? String(nextFrom) : undefined;

    return NextResponse.json({
      logs,
      total,
      size: params.size,
      from: params.from,
      source: params.sourceId,
      ...(nextCursor && { nextCursor }),
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
