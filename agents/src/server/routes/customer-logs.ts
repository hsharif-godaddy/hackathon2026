/**
 * Customer Logs Routes
 *
 * Provides customer-facing API for accessing deployment logs from preview/publish containers.
 * Logs are sanitized to remove sensitive information before being returned.
 *
 * All validation is handled by the CustomerLogsService - the route layer only handles
 * HTTP concerns (parsing query params, mapping service responses to HTTP responses).
 */

import { Router, Request, Response } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { CustomerLogsService, type CustomerLogsRequest } from '../../services/customer-logs-service.js';
import { LogSanitizer } from '../../services/log-sanitizer.js';
import { Logger } from '../../logging/index.js';

const logger = Logger.create({ component: 'customer-logs-routes' });

// Singleton instances for production use
let _appRepo: AppRepository | null = null;
let _customerLogsService: CustomerLogsService | null = null;

function getAppRepo(): AppRepository {
  if (!_appRepo) {
    _appRepo = new AppRepository();
  }
  return _appRepo;
}

function getCustomerLogsService(): CustomerLogsService {
  if (!_customerLogsService) {
    _customerLogsService = new CustomerLogsService(getAppRepo(), new LogSanitizer());
  }
  return _customerLogsService;
}

// For testing: allow resetting/injecting dependencies
export function _resetDependencies(): void {
  _appRepo = null;
  _customerLogsService = null;
}

export function _setDependencies(appRepo: AppRepository, service: CustomerLogsService): void {
  _appRepo = appRepo;
  _customerLogsService = service;
}

const router: Router  = Router();

/**
 * GET /apps/:appId/customer-logs
 *
 * Fetch deployment logs for a customer app.
 *
 * Query Parameters:
 * - lines: number (default: 100, max: configurable via CUSTOMER_LOGS_MAX_LINES env, default 500)
 * - source: 'stdout' | 'stderr' | comma-separated (e.g., 'stdout,stderr') - Filter by output source(s). Optional, defaults to all.
 * - target: 'preview' | 'publish' (required) - Target environment
 * - since: ISO 8601 timestamp (optional) - Fetch logs since this time
 *
 * Response:
 * - 200: { logs: SanitizedLogEntry[], total: number }
 * - 400: Validation error
 * - 404: App not found
 * - 500: Internal error
 * - 503: Supervisor unavailable
 */
router.get('/:appId/customer-logs', async (req: Request, res: Response) => {
  const { appId } = req.params;
  const { lines, source, target, since } = req.query;

  logger.info('route.customer-logs.request', {
    appId,
    lines,
    source,
    target,
    since
  });

  try {
    // Parse query params once and reuse
    const parsedSources = parseSourceParam(source);
    const parsedLines = lines ? parseInt(lines as string, 10) : undefined;

    logger.debug('route.customer-logs.params-parsed', {
      appId,
      rawSource: source,
      parsedSources,
      parsedLines
    });

    // Build request - let service handle all validation
    const request: CustomerLogsRequest = {
      appId: appId || '',
      lines: parsedLines,
      sources: parsedSources,
      target: target as 'preview' | 'publish',
      since: since as string | undefined
    };

    // Fetch logs via service (service handles all validation)
    const result = await getCustomerLogsService().getLogs(request);

    // Map service response to HTTP response
    if (!result.success) {
      const statusCode = getStatusCode(result.code);

      logger.warn('route.customer-logs.validation-failed', {
        appId,
        code: result.code,
        error: result.error,
        statusCode,
        target,
        lines: parsedLines,
        sources: parsedSources
      });

      return res.status(statusCode).json({
        error: result.error,
        code: result.code
      });
    }

    logger.info('route.customer-logs.success', {
      appId,
      target,
      logsReturned: result.total,
      lines: parsedLines,
      sources: parsedSources,
      since
    });

    return res.json({
      logs: result.logs,
      total: result.total
    });
  } catch (error) {
    logger.error('route.customer-logs.error', {
      appId,
      target,
      lines,
      source,
      since,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: error instanceof Error ? error.constructor.name : typeof error
    });

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * Parse source parameter - supports single value, comma-separated, or array
 * @param source - Raw source query parameter
 * @returns Array of valid sources, or undefined for all sources
 */
function parseSourceParam(source: unknown): Array<'stdout' | 'stderr'> | undefined {
  if (source === undefined) {
    return undefined; // undefined means all sources
  }

  // Handle array (e.g., ?source=stdout&source=stderr)
  if (Array.isArray(source)) {
    const sources = source.filter(s => s === 'stdout' || s === 'stderr') as Array<'stdout' | 'stderr'>;
    return sources.length > 0 ? sources : undefined;
  }

  const sourceStr = String(source);

  // Handle 'all' as undefined (all sources)
  if (sourceStr === 'all') {
    return undefined;
  }

  // Handle comma-separated (e.g., ?source=stdout,stderr)
  if (sourceStr.includes(',')) {
    const sources = sourceStr.split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s === 'stdout' || s === 'stderr') as Array<'stdout' | 'stderr'>;
    return sources.length > 0 ? sources : undefined;
  }

  // Handle single value
  if (sourceStr === 'stdout' || sourceStr === 'stderr') {
    return [sourceStr];
  }

  // Return as-is and let service validate (will return INVALID_SOURCE error)
  return [sourceStr as 'stdout' | 'stderr'];
}

/**
 * Map error codes to HTTP status codes
 */
function getStatusCode(code: string | undefined): number {
  switch (code) {
    case 'APP_NOT_FOUND':
      return 404;
    case 'INVALID_APP_ID':
    case 'INVALID_LINES':
    case 'INVALID_SOURCE':
    case 'INVALID_TARGET':
    case 'INVALID_TIMESTAMP':
    case 'MISSING_TARGET':
      return 400;
    case 'SUPERVISOR_NOT_CONFIGURED':
    case 'SUPERVISOR_UNAVAILABLE':
      return 503;
    case 'FETCH_ERROR':
    default:
      return 500;
  }
}

export { router as customerLogsRouter };
