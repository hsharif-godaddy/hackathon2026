import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/request-context';
import { withCustomerAuth, type CustomerAuthContext } from '@/lib/customer-auth';

/**
 * Force dynamic rendering - prevent static generation
 */
export const dynamic = 'force-dynamic';

/**
 * Disable caching - always fetch fresh data
 */
export const revalidate = 0;

/**
 * Check if TLA restriction should be enforced
 * Only enforced when ENVIRONMENT_NAME is 'production'
 */
function isTLARestrictionEnabled(): boolean {
  return process.env.ENVIRONMENT_NAME === 'production';
}

/**
 * Check if user is a TLA (Three Letter Acronym - internal GoDaddy employee)
 * TLA users have a shopperId with 3 or fewer characters
 *
 * @param shopperId - User's shopper ID
 * @returns True if user is a TLA
 */
function isTLAUser(shopperId: string): boolean {
  return shopperId.length <= 3;
}

/**
 * Get Elasticsearch configuration at runtime
 * Using dynamic key access to prevent Next.js from inlining at build time
 */
function getESConfig() {
  // Dynamic access prevents Next.js static replacement
  const env = process.env;
  const endpointKey = 'PIONEER_ES_ENDPOINT';
  const apiKeyKey = 'PIONEER_ES_API_KEY';
  const envNameKey = 'ENVIRONMENT_NAME';

  // Use dev index for test environment, prod index otherwise
  const isTestEnv = env[envNameKey] === 'test' ||  env[envNameKey] === 'dev';

  return {
    endpoint: env[endpointKey] || 'https://pioneerc1-non-prod-usw2.es.us-west-2.aws.found.io:9243',
    apiKey: env[apiKeyKey] || '',
    index: isTestEnv ? 'airo-agents-dev' : 'airo-agents-prod'
  };
}

/**
 * Log entry structure from Elasticsearch
 */
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

/**
 * Search response from Elasticsearch
 */
interface ESSearchResponse {
  hits: {
    total: { value: number };
    hits: LogEntry[];
  };
}

/**
 * GET handler for fetching logs from Elasticsearch
 * Restricted to TLA users only in production environment.
 */
export const GET = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  const startMs = Date.now();
  logger.info('logs-api.request.begin', { message: 'GET request received' });

  // Check if user is a TLA (only enforced in production)
  if (isTLARestrictionEnabled() && !isTLAUser(authContext.user.shopperId)) {
    logger.debug('logs-api.tla_required', {
      reason: 'User is not a TLA',
      shopperId: authContext.user.shopperId
    });
    return NextResponse.json(
      { error: 'This feature is only available for internal users' },
      { status: 403 }
    );
  }

  try {
    // Get config at runtime (not build time) so env vars are fresh
    const ES_CONFIG = getESConfig();
    logger.debug('logs-api.config.check', { message: 'ES config loaded', endpoint: ES_CONFIG.endpoint, index: ES_CONFIG.index, hasApiKey: !!ES_CONFIG.apiKey });

    // Check if API key is configured
    if (!ES_CONFIG.apiKey) {
      // Log debug info server-side only - never expose to client
      logger.warn('logs-api.config.missing-api-key', {
        message: 'API key not configured',
        hasApiKey: false
      });
      return NextResponse.json({
        logs: [],
        total: 0,
        size: 0,
        from: 0,
        warning: 'Elasticsearch API key not configured'
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        }
      });
    }

    const { searchParams } = new URL(request.url);
    const size = parseInt(searchParams.get('size') || '100', 10);
    const from = parseInt(searchParams.get('from') || '0', 10);
    const level = searchParams.get('level');
    const query = searchParams.get('query');
    const appId = searchParams.get('appId');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');

    logger.debug('logs-api.query.params', { message: 'Query params parsed', size, from, level, query, appId, startTime, endTime });

    // Build Elasticsearch query
    const must: object[] = [];
    const filter: object[] = [];

    // Add time range filter
    if (startTime || endTime) {
      const rangeQuery: { range: { '@timestamp': { gte?: string; lte?: string } } } = {
        range: {
          '@timestamp': {}
        }
      };
      if (startTime) {
        rangeQuery.range['@timestamp'].gte = startTime;
      }
      if (endTime) {
        rangeQuery.range['@timestamp'].lte = endTime;
      }
      filter.push(rangeQuery);
    }

    // Add log level filter - try both level and level.keyword for compatibility
    if (level && level !== 'all') {
      filter.push({
        bool: {
          should: [
            { term: { 'level': level } },
            { term: { 'level.keyword': level } }
          ],
          minimum_should_match: 1
        }
      });
    }

    // Add appId filter - try both app_id and app_id.keyword for compatibility
    if (appId) {
      filter.push({
        bool: {
          should: [
            { term: { 'app_id': appId } },
            { term: { 'app_id.keyword': appId } }
          ],
          minimum_should_match: 1
        }
      });
    }

    // Add search query
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ['message', 'event', 'app_id', 'logger', 'service', 'hostname'],
          type: 'phrase_prefix'
        }
      });
    }

    const esQuery = {
      size,
      from,
      sort: [{ '@timestamp': { order: 'desc' } }],
      query: {
        bool: {
          must: must.length > 0 ? must : [{ match_all: {} }],
          filter
        }
      }
    };

    logger.debug('logs-api.query.built', { message: 'ES query built', esQuery });

    const response = await fetch(
      `${ES_CONFIG.endpoint}/${ES_CONFIG.index}/_search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ApiKey ${ES_CONFIG.apiKey}`
        },
        body: JSON.stringify(esQuery)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('logs-api.es.error', { message: 'ES error response', status: response.status, error: errorText });

      // Handle 404 (index not found) gracefully
      if (response.status === 404) {
        logger.warn('logs-api.es.index-not-found', { message: 'Index not found, returning empty result' });
        return NextResponse.json({
          logs: [],
          total: 0,
          size,
          from,
          warning: 'Elasticsearch index not found - no logs available'
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

    // Transform the response for the frontend
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
      raw: hit._source
    }));

    return NextResponse.json({
      logs,
      total: data.hits.total.value,
      size,
      from
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    logger.error('logs-api.error', { message: 'Error fetching logs', error: error instanceof Error ? error.message : String(error), durationMs });
    return NextResponse.json(
      { error: 'Internal server error while fetching logs' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        }
      }
    );
  }
});
