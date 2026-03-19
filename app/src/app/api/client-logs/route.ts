/**
 * Client Log Shipping API Endpoint
 *
 * Receives batched client-side logs and forwards them to the server-side
 * logging infrastructure (which outputs to stdout for FluentBit/Elasticsearch).
 *
 * Security considerations:
 * - Batch size limits (max 50 logs per request)
 * - Payload size limits (max 10KB per log data field)
 * - Input sanitization to prevent log injection
 *
 * @example
 * POST /api/client-logs
 * Content-Type: application/json
 * {
 *   "logs": [
 *     { "level": "error", "event": "api.failure", "message": "...", ... }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';

import { withApmRoute } from '@/lib/apm-context';
import { authenticateCustomer } from '@/lib/customer-auth';
import { logger, LogLevel } from '@/lib/request-context';

/**
 * Maximum number of logs accepted per request
 */
const MAX_BATCH_SIZE = 50;

/**
 * Maximum size of individual log data in characters
 */
const MAX_DATA_SIZE = 10000;

/**
 * Allowed log levels for validation
 */
const VALID_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

/**
 * Client log event structure for validation
 */
interface ClientLogPayload {
  timestamp?: string;
  level: LogLevel;
  event: string;
  message?: string;
  data?: Record<string, unknown>;
  source?: string;
  sessionId?: string;
  pageUrl?: string;
  userAgent?: string;
  'trace.id'?: string;
  'transaction.id'?: string;
  error?: {
    message?: string;
    stack?: string;
    name?: string;
  };
  duration?: number;
  tags?: string[];
}

/**
 * Request payload structure
 */
interface LogsRequestPayload {
  logs: ClientLogPayload[];
}

/**
 * Validate that a value is a valid log level
 *
 * @param level - Value to check
 * @returns True if valid log level
 */
function isValidLevel(level: unknown): level is LogLevel {
  return typeof level === 'string' && VALID_LOG_LEVELS.includes(level as LogLevel);
}

/**
 * Sanitize a string to prevent log injection attacks
 *
 * @param str - String to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized string
 */
function sanitize(str: unknown, maxLength: number = 1000): string {
  if (typeof str !== 'string') return '';

  return str
    .slice(0, maxLength)
    .replace(/[\r\n]/g, ' ')  // Remove newlines to prevent log injection
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, ''); // Remove control characters
}

/**
 * Sanitize and validate a single log event
 *
 * @param log - Raw log payload from client
 * @returns Sanitized log or null if invalid
 */
function sanitizeLog(log: unknown): ClientLogPayload | null {
  if (!log || typeof log !== 'object') return null;

  const rawLog = log as Record<string, unknown>;

  // Validate required fields
  if (!isValidLevel(rawLog.level)) return null;
  if (typeof rawLog.event !== 'string' || rawLog.event.length === 0) return null;

  const sanitized: ClientLogPayload = {
    level: rawLog.level,
    event: sanitize(rawLog.event, 200),
  };

  // Optional fields with sanitization
  if (rawLog.timestamp && typeof rawLog.timestamp === 'string') {
    // Validate ISO timestamp format
    const timestamp = new Date(rawLog.timestamp);
    if (!isNaN(timestamp.getTime())) {
      sanitized.timestamp = timestamp.toISOString();
    }
  }

  if (rawLog.message && typeof rawLog.message === 'string') {
    sanitized.message = sanitize(rawLog.message, 500);
  }

  if (rawLog.sessionId && typeof rawLog.sessionId === 'string') {
    sanitized.sessionId = sanitize(rawLog.sessionId, 100);
  }

  if (rawLog.pageUrl && typeof rawLog.pageUrl === 'string') {
    sanitized.pageUrl = sanitize(rawLog.pageUrl, 500);
  }

  if (rawLog.userAgent && typeof rawLog.userAgent === 'string') {
    sanitized.userAgent = sanitize(rawLog.userAgent, 300);
  }

  if (rawLog['trace.id'] && typeof rawLog['trace.id'] === 'string') {
    sanitized['trace.id'] = sanitize(rawLog['trace.id'], 64);
  }

  if (rawLog['transaction.id'] && typeof rawLog['transaction.id'] === 'string') {
    sanitized['transaction.id'] = sanitize(rawLog['transaction.id'], 64);
  }

  if (rawLog.duration && typeof rawLog.duration === 'number') {
    sanitized.duration = Math.min(Math.max(0, rawLog.duration), 3600000); // Max 1 hour
  }

  if (rawLog.tags && Array.isArray(rawLog.tags)) {
    sanitized.tags = rawLog.tags
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 10)
      .map(t => sanitize(t, 50));
  }

  // Sanitize data object
  if (rawLog.data && typeof rawLog.data === 'object' && !Array.isArray(rawLog.data)) {
    try {
      const dataStr = JSON.stringify(rawLog.data);
      if (dataStr.length <= MAX_DATA_SIZE) {
        // Re-parse to ensure valid JSON structure
        sanitized.data = JSON.parse(dataStr);
      }
    } catch {
      // Skip invalid data
    }
  }

  // Sanitize error object
  if (rawLog.error && typeof rawLog.error === 'object') {
    const rawError = rawLog.error as Record<string, unknown>;
    sanitized.error = {
      message: sanitize(rawError.message, 500),
      name: sanitize(rawError.name, 100),
      stack: sanitize(rawError.stack, 2000),
    };
  }

  return sanitized;
}

/**
 * POST handler for receiving client logs
 *
 * @param request - Incoming request with log batch
 * @returns JSON response with processing result
 */
export const POST = withApmRoute(async (request: NextRequest): Promise<NextResponse> => {
  try {
    // Parse request body
    let payload: LogsRequestPayload;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Validate payload structure
    if (!payload.logs || !Array.isArray(payload.logs)) {
      return NextResponse.json(
        { error: 'Missing or invalid logs array' },
        { status: 400 }
      );
    }

    // Enforce batch size limit - process up to MAX_BATCH_SIZE
    const logs = payload.logs.slice(0, MAX_BATCH_SIZE);
    const dropped = payload.logs.length - logs.length;

    if (dropped > 0) {
      logger.warn('api.logs.batch_overflow', {
        received: payload.logs.length,
        maxAllowed: MAX_BATCH_SIZE,
        dropped,
        message: 'Client sent more logs than batch limit allows',
      });
    }

    // Extract client metadata from request
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    let customerId: string | undefined;
    let shopperId: string | undefined;
    let isTLA = false;
    try {
      const authContext = await authenticateCustomer(request);
      if (authContext.isAuthenticated) {
        customerId = authContext.user.customerId;
        shopperId = authContext.user.shopperId;
        // TLA (Three Letter Account) indicates GoDaddy employee accounts
        isTLA = shopperId?.length === 3;
      }
    } catch {
      // Auth extraction failed - continue without customer context
      // This is expected for unauthenticated users
    }

    // Process and forward logs
    let processed = 0;
    let skipped = 0;

    for (const rawLog of logs) {
      const sanitized = sanitizeLog(rawLog);

      if (!sanitized) {
        skipped++;
        continue;
      }

      // Forward to server logger with client prefix and tenant context
      logger.log(sanitized.level, `client.${sanitized.event}`, {
        ...(sanitized.message ? { message: sanitized.message } : {}),
        ...sanitized.data,
        ...(customerId ? { customerId } : {}),
        isTLA,
        clientIp,
        userAgent: sanitized.userAgent || userAgent, // Prefer payload, fallback to header
        sessionId: sanitized.sessionId,
        pageUrl: sanitized.pageUrl,
        ...(sanitized['trace.id'] ? { 'client.trace.id': sanitized['trace.id'] } : {}),
        ...(sanitized['transaction.id'] ? { 'client.transaction.id': sanitized['transaction.id'] } : {}),
        ...(sanitized.error ? { clientError: sanitized.error } : {}),
        ...(sanitized.duration !== undefined ? { duration: sanitized.duration } : {}),
        ...(sanitized.tags ? { tags: sanitized.tags } : {}),
      });

      processed++;
    }

    logger.debug('api.logs.received', {
      processed,
      skipped,
      dropped,
      total: logs.length,
      ...(customerId ? { customerId } : {}),
    });

    return NextResponse.json({
      received: processed,
      skipped,
      dropped,
      ...(dropped > 0 ? { 
        warning: `${dropped} logs exceeded batch limit (${MAX_BATCH_SIZE}) and were not processed` 
      } : {}),
    });
  } catch (error) {
    logger.error('api.logs.failure', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * OPTIONS handler for CORS preflight
 */
export const OPTIONS = withApmRoute(async (_request): Promise<NextResponse> => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
});

