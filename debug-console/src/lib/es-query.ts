/**
 * Shared Elasticsearch query builder for ES-backed log sources (`airo-app`,
 * `control_plane`). Used by `/api/es-logs` (server) and the Logs tab Query
 * viewer (client) so the rendered preview matches what the server actually
 * sends.
 *
 * The two ES sources have a single shared shape: `bool.must` clauses for
 * level / free-text / app id / time range, with `match_all` fallback when
 * no filters are active. Pure data — no env reads — so it's safe to import
 * client-side.
 */

import {
  airoAppFieldMapping,
  buildAppIdQuery,
  controlPlaneFieldMapping,
  type FieldMapping,
} from './log-sources';

export interface ESQueryInput {
  fieldMapping: FieldMapping;
  size: number;
  from: number;
  /** Single-level filter ('error', 'warn', etc.) or 'all'. */
  level?: string | null;
  /** Comma-separated list, e.g. 'error,warn'. Takes precedence over `level`. */
  levels?: string | null;
  /** Free-text search query. */
  query?: string | null;
  appId?: string | null;
  /** ISO start; when omitted, no `range` clause is emitted. */
  startTime?: string | null;
  /** ISO end; only used when `startTime` is also set. */
  endTime?: string | null;
}

/**
 * Build the Elasticsearch request body sent to the `_search` endpoint.
 * Mirrors the construction in `/api/es-logs` so the route and the preview
 * stay in sync.
 */
export function buildElasticsearchRequestBody(input: ESQueryInput): Record<string, unknown> {
  const { fieldMapping, size, from, level, levels, query, appId, startTime, endTime } = input;
  const mustClauses: Array<Record<string, unknown>> = [];
  const levelKeywordField = fieldMapping.levelKeywordField;

  if (levels) {
    const levelList = levels.split(',').map(l =>
      fieldMapping.logLevelFieldMap?.[l.trim().toLowerCase()] || l.trim().toUpperCase()
    );
    const rawLevelPatterns = levels.split(',').map(l => l.trim().toUpperCase());
    mustClauses.push({
      bool: {
        should: [
          { terms: { [levelKeywordField]: levelList } },
          ...rawLevelPatterns.map(p => ({
            bool: {
              must: [
                { match_phrase: { log: p } },
                { bool: { must_not: [{ exists: { field: levelKeywordField } }] } },
              ],
            },
          })),
        ],
        minimum_should_match: 1,
      },
    });
  } else if (level && level !== 'all') {
    const mappedLevel = fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();
    mustClauses.push({
      bool: {
        should: [
          { term: { [levelKeywordField]: mappedLevel } },
          {
            bool: {
              must: [
                { match_phrase: { log: level.toUpperCase() } },
                { bool: { must_not: [{ exists: { field: levelKeywordField } }] } },
              ],
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (query) {
    mustClauses.push({
      multi_match: {
        query,
        fields: [
          'message^2', 'log', 'event', 'logger', 'service', 'app_id', 'appId',
          'customerId', 'customer.id', 'hostname', 'environment', 'region',
          'version', 'data.message',
        ],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });
  }

  if (appId && fieldMapping.appIdField) {
    const appIdQuery = buildAppIdQuery(appId, fieldMapping);
    if (appIdQuery) mustClauses.push(appIdQuery);
  }

  if (startTime) {
    mustClauses.push({
      range: {
        '@timestamp': {
          gte: startTime,
          ...(endTime ? { lte: endTime } : {}),
        },
      },
    });
  }

  return {
    size,
    from,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
      },
    },
  };
}

/**
 * Map of ES source ids to their FieldMapping. Re-exported here as a
 * client-safe registry so the renderer can dispatch by source id without
 * touching `getLogSourceConfig` (which performs env reads).
 */
export const ES_SOURCE_FIELD_MAPPINGS: Record<string, FieldMapping> = {
  'airo-app': airoAppFieldMapping,
  'control_plane': controlPlaneFieldMapping,
};

export function isESSource(sourceId: string): boolean {
  return sourceId in ES_SOURCE_FIELD_MAPPINGS;
}

export interface ESQueryPreviewInput {
  /** ES source id ('airo-app' or 'control_plane'). */
  sourceId: string;
  /** App id from the global filter, or empty for no app filter. */
  appId: string;
  levels: { error: boolean; warn: boolean };
  filterText: string;
}

/**
 * Pretty-printed JSON preview of the ES request body that the Logs tab
 * would send for the given filter state. Returns null when the source id
 * isn't a known ES source (caller should hide the viewer).
 *
 * The page-size (50) and `from: 0` here mirror the Logs tab's first-page
 * request. The Logs panel concatenates checked level keywords into the
 * server's `query` URL param (not a separate `levels` param), so on the
 * server the structured-level boolean branch isn't taken — the levels are
 * matched via the same multi_match clause as free-text. We mirror that
 * here so the rendered preview equals what the route actually sends.
 * Pagination cursors are not represented since the user is reasoning
 * about the initial query.
 */
export function renderESQueryPreview(input: ESQueryPreviewInput): string | null {
  const fieldMapping = ES_SOURCE_FIELD_MAPPINGS[input.sourceId];
  if (!fieldMapping) return null;

  const enabledLevels: string[] = [];
  if (input.levels.error) enabledLevels.push('error');
  if (input.levels.warn) enabledLevels.push('warn');

  const queryText = [enabledLevels.join(' '), input.filterText.trim()]
    .filter(Boolean)
    .join(' ');

  const body = buildElasticsearchRequestBody({
    fieldMapping,
    size: 50,
    from: 0,
    query: queryText || null,
    appId: input.appId || null,
  });

  return JSON.stringify(body, null, 2);
}
