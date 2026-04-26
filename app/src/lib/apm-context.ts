/**
 * OpenTelemetry Context Utilities
 *
 * Provides utilities for adding context to OpenTelemetry spans/traces.
 * These utilities help attach customer and request context to spans
 * for better traceability and debugging in Elastic APM.
 *
 * Works with Next.js App Router:
 * - API Routes: Use withApmTransaction() or startApmTransaction/endApmTransaction
 * - Server Components: Use addApmPageContext() at the top of page components
 * - Middleware wrapper: withCustomerAuth() in customer-auth.ts auto-creates spans
 *
 * Verified customer context (e.g., authenticated customerId) is only set AFTER
 * successful JWT signature verification to prevent observability pollution from
 * forged tokens. However, withCustomerAuth() may also attach a best-effort,
 * UNVERIFIED cid derived from the decoded JWT payload on failed auth responses
 * (such as 401s) to help correlate and debug rejected requests. This unverified
 * cid must not be treated as a security signal and is for observability only.
 *
 * When mocking in tests, use vi.mock('@/lib/apm-context', ...) — not '@/lib/apm'
 * (which does not exist). The correct exports to stub are: startApmTransaction,
 * addApmContext, extractAppIdFromPath, setApmAppId, setApmCustomerId, setApmJobId,
 * setApmUserContext.
 */

import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { context, Span, SpanStatusCode, trace } from '@opentelemetry/api';

import { decodeTokenPayload, extractTokenFromRequest } from '@/lib/gd-auth-service';

interface ApmAuthContext {
  user?: {
    customerId?: string;
  };
}

interface ApmPageContext {
  customerId?: string;
  appId?: string;
  market?: string;
}

interface OtelSpan {
  name: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setLabel(key: string, value: string | number | boolean): void;
  updateName(name: string): void;
  setStatus(status: { code: SpanStatusCode; message?: string }): void;
  end(result?: string): void;
}

const TRACER_NAME = 'airo-app-builder';

const isDebug = () => process.env.OTEL_DEBUG === 'true' || process.env.ELASTIC_APM_DEBUG === 'true';
const debugLog = (msg: string, ...args: unknown[]) => {
  if (isDebug()) {
    console.log('[OTel Context]', msg, ...args);
  }
};

/**
 * Get a tracer instance for creating spans
 */
function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Get the currently active span
 * Returns null if no span is active or if running on client
 */
export function getActiveSpan(): Span | null {
  if (typeof window !== 'undefined') {
    return null;
  }

  try {
    const span = trace.getActiveSpan();
    if (span) {
      debugLog('getActiveSpan: Found active span');
      return span;
    }
    debugLog('getActiveSpan: No active span');
  } catch (e) {
    debugLog('getActiveSpan error:', e);
  }

  return null;
}

/**
 * Check if OpenTelemetry is available
 * This replaces the old getApmAgent() function
 */
export function getApmAgent(): { isStarted: () => boolean } | null {
  if (typeof window !== 'undefined') {
    return null;
  }

  return {
    isStarted: () => true
  };
}

/**
 * Set an attribute on the current active span
 * Safe to call even if no span is active
 */
export function setApmLabel(name: string, value: string | number | boolean): void {
  const span = getActiveSpan();
  if (!span) {
    debugLog('setApmLabel: No active span');
    return;
  }

  try {
    span.setAttribute(name, value);
    debugLog('setApmLabel:', name, '=', value);
  } catch (e) {
    debugLog('setApmLabel error:', e);
  }
}

/**
 * Set customerId on the current span
 * Uses 'cid' as the attribute name for consistency with other GoDaddy APM implementations
 */
export function setApmCustomerId(customerId: string): void {
  setApmLabel('cid', customerId);
}

/**
 * Set appId on the current span
 */
export function setApmAppId(appId: string): void {
  setApmLabel('appId', appId);
}

/**
 * Set jobId on the current span
 * Used when appId is not yet available (e.g., during async job creation)
 */
export function setApmJobId(jobId: string): void {
  setApmLabel('jobId', jobId);
}

/**
 * Set user context on the current span
 * Uses enduser.id attribute per OpenTelemetry semantic conventions
 */
export function setApmUserContext(userId: string): void {
  const span = getActiveSpan();
  if (!span) return;

  try {
    span.setAttribute('enduser.id', userId);
  } catch {
    // Silently fail if span errors
  }
}

/**
 * Set the name of the current span
 */
export function setApmTransactionName(name: string): void {
  const span = getActiveSpan();
  if (!span) {
    debugLog('setApmTransactionName: No active span');
    return;
  }

  try {
    span.updateName(name);
    debugLog('setApmTransactionName:', name);
  } catch (e) {
    debugLog('setApmTransactionName error:', e);
  }
}

/**
 * Ensure the current span has the correct name
 * Updates the active span name or creates a new span if none exists
 */
export function ensureApmTransactionNamed(name: string, type: string = 'request'): OtelSpan | null {
  const existingSpan = getActiveSpan();

  if (existingSpan) {
    try {
      existingSpan.updateName(name);
      existingSpan.setAttribute('span.type', type);
      debugLog('ensureApmTransactionNamed: Updated existing span:', name);
      // ownsSpan=false: Don't end spans created by @vercel/otel
      return wrapSpan(existingSpan, false);
    } catch (e) {
      debugLog('ensureApmTransactionNamed error:', e);
    }
  }

  // No active span, start a new one
  const tracer = getTracer();
  const newSpan = tracer.startSpan(name, { attributes: { 'span.type': type } });
  debugLog('ensureApmTransactionNamed: Started new span:', name);
  // ownsSpan=true: We created this span, so we should end it
  return wrapSpan(newSpan, true);
}

/**
 * Get current trace IDs for log correlation
 * Returns trace.id and span.id in OpenTelemetry format
 */
export function getApmTraceIds(): { 'trace.id'?: string; 'transaction.id'?: string; 'span.id'?: string } {
  const span = getActiveSpan();
  if (!span) {
    debugLog('getApmTraceIds: No active span');
    return {};
  }

  try {
    const spanContext = span.spanContext();
    if (spanContext) {
      const traceIds = {
        'trace.id': spanContext.traceId,
        'transaction.id': spanContext.spanId,
        'span.id': spanContext.spanId
      };
      debugLog('getApmTraceIds:', traceIds);
      return traceIds;
    }
    debugLog('getApmTraceIds: No span context');
  } catch (e) {
    debugLog('getApmTraceIds error:', e);
  }

  return {};
}

/**
 * Add customer context to the current span
 * Should be called after authentication populates the auth context
 */
export function addApmContext(request: NextRequest, authContext?: ApmAuthContext): void {
  const span = getActiveSpan();
  if (!span) {
    debugLog('addApmContext: No active span');
    return;
  }

  try {
    // Set span name from URL
    const urlPath = new URL(request.url).pathname;
    const txName = `${request.method} ${urlPath}`;
    span.updateName(txName);
    debugLog('addApmContext: Set span name:', txName);

    if (authContext?.user?.customerId) {
      span.setAttribute('cid', authContext.user.customerId);
      span.setAttribute('enduser.id', authContext.user.customerId);
      debugLog('addApmContext: Set cid:', authContext.user.customerId);
    }
  } catch (e) {
    debugLog('addApmContext error:', e);
  }
}

/**
 * Extract appId from URL path if present
 * Matches app-related routes with [id] or [appId] parameters
 */
export function extractAppIdFromPath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;

    const idRouteMatch = pathname.match(/\/api\/(?:sites|apps|servers|develop|conversations|database|secrets)\/([a-zA-Z0-9-]+)(?:\/|$)/);
    if (idRouteMatch && idRouteMatch[1] && !['quick-create', 'create'].includes(idRouteMatch[1])) {
      return idRouteMatch[1];
    }

    const appIdRouteMatch = pathname.match(/\/api\/(?:database|secrets)\/([a-zA-Z0-9-]+)(?:\/|$)/);
    if (appIdRouteMatch && appIdRouteMatch[1]) {
      return appIdRouteMatch[1];
    }
  } catch {
    // Ignore URL parsing errors
  }
  return null;
}

/**
 * Wrap an OpenTelemetry Span to provide a consistent interface
 * Maintains backward compatibility with elastic-apm-node's transaction API
 *
 * @param span - The underlying OTel span
 * @param ownsSpan - If true, we created the span and should end it. If false,
 *                   the span was created by @vercel/otel and we should NOT end it.
 */
function wrapSpan(span: Span, ownsSpan: boolean): OtelSpan {
  return {
    get name() {
      return '';
    },
    setAttribute(key: string, value: string | number | boolean) {
      span.setAttribute(key, value);
    },
    setLabel(key: string, value: string | number | boolean) {
      span.setAttribute(key, value);
    },
    updateName(name: string) {
      span.updateName(name);
    },
    setStatus(status: { code: SpanStatusCode; message?: string }) {
      span.setStatus(status);
    },
    end(result?: string) {
      if (result) {
        span.setAttribute('http.result', result);
      }
      // Only end spans we created ourselves; @vercel/otel manages its own span lifecycle
      if (ownsSpan) {
        span.end();
      }
    }
  };
}

/**
 * Start a new span or update an existing active span
 * Use this for Next.js API routes since automatic HTTP instrumentation may not work perfectly
 *
 * @param name - Span name (e.g., "GET /api/sites")
 * @param type - Span type (default: "request")
 * @returns The span object, or null if OTel is not available
 */
export function startApmTransaction(name: string, type: string = 'request'): OtelSpan | null {
  if (typeof window !== 'undefined') {
    return null;
  }

  try {
    // Check for existing active span first (e.g., from @vercel/otel)
    const existingSpan = trace.getActiveSpan();
    if (existingSpan) {
      existingSpan.updateName(name);
      existingSpan.setAttribute('span.type', type);
      debugLog('startApmTransaction: Updated existing span:', name);
      // ownsSpan=false: Don't end spans created by @vercel/otel
      return wrapSpan(existingSpan, false);
    }

    // No existing span, create a new one
    const tracer = getTracer();
    const span = tracer.startSpan(name, {
      attributes: { 'span.type': type }
    });
    debugLog('startApmTransaction: Created new span:', name, type);
    // ownsSpan=true: We created this span, so we should end it
    return wrapSpan(span, true);
  } catch (e) {
    debugLog('startApmTransaction error:', e);
    return null;
  }
}

/**
 * End the current active span
 *
 * @param result - Span result (e.g., "success", "HTTP 2xx", "HTTP 4xx")
 */
export function endApmTransaction(result?: string): void {
  const span = getActiveSpan();
  if (!span) {
    debugLog('endApmTransaction: No active span');
    return;
  }

  try {
    if (result) {
      span.setAttribute('http.result', result);
    }
    span.end();
    debugLog('endApmTransaction:', result || 'unknown');
  } catch (e) {
    debugLog('endApmTransaction error:', e);
  }
}

/**
 * Wrapper to run an async function within a span
 * Automatically starts and ends the span, handling errors
 *
 * @param name - Span name
 * @param fn - Async function to execute within the span
 * @returns The result of the function
 */
export async function withApmTransaction<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name);

  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return result;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
    span.end();
    throw error;
  }
}

/**
 * Get customer ID from NextRequest by decoding auth token
 * Used by withApmRoute to add cid label to public API spans when user is logged in
 */
async function getCustomerIdFromRequest(request: NextRequest): Promise<string | null> {
  try {
    const token = extractTokenFromRequest(request);

    if (!token) {
      debugLog('getCustomerIdFromRequest: No auth token found');
      return null;
    }

    const claims = decodeTokenPayload(token);
    if (claims?.cid) {
      debugLog('getCustomerIdFromRequest: Got cid from decoded payload:', claims.cid);
      return claims.cid;
    }

    debugLog('getCustomerIdFromRequest: No cid in decoded payload');
    return null;
  } catch (e) {
    debugLog('getCustomerIdFromRequest error:', e);
    return null;
  }
}

/**
 * Wrapper for API routes that don't require authentication but need instrumentation
 * Use this for public endpoints like /api/health, /api/config, etc.
 *
 * With @vercel/otel, Next.js already creates spans for routes. This wrapper:
 * - Updates the span name with the full route path
 * - Adds cid label if user is logged in
 * - Adds http attributes and status
 * - Does NOT end the span (@vercel/otel manages the lifecycle)
 *
 * Usage:
 *   export const GET = withApmRoute(async (request) => {
 *     return NextResponse.json({ status: 'ok' });
 *   });
 */
export function withApmRoute<T extends unknown[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    const urlPath = new URL(request.url).pathname;
    const txName = `${request.method} ${urlPath}`;

    // Use startApmTransaction which reuses existing spans from @vercel/otel
    const transaction = startApmTransaction(txName, 'request');
    transaction?.setAttribute('http.method', request.method);
    transaction?.setAttribute('http.url', urlPath);

    try {
      // Try to extract customer ID from cookies if user is logged in
      const customerId = await getCustomerIdFromRequest(request);
      if (customerId) {
        transaction?.setLabel('cid', customerId);
        debugLog('withApmRoute: Set cid attribute:', customerId);
      }

      const response = await handler(request, ...args);
      const status = response.status;

      transaction?.setAttribute('http.status_code', status);
      if (status >= 200 && status < 300) {
        transaction?.setStatus({ code: SpanStatusCode.OK });
      } else if (status >= 400) {
        transaction?.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
      }

      debugLog('withApmRoute: Completed', txName, 'status:', status);
      // transaction.end() is safe to call - wrapSpan handles ownership
      transaction?.end(`HTTP ${status}`);
      return response;
    } catch (error) {
      transaction?.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown error' });
      transaction?.end('error');
      debugLog('withApmRoute: Completed with error', txName);
      throw error;
    }
  };
}

/**
 * Add context for a Server Component page
 * Call this at the top of page.tsx Server Components
 *
 * With @vercel/otel, this uses the existing span created by Next.js.
 * It adds context attributes but does NOT end the span.
 *
 * @param pagePath - The page route pattern (e.g., "/develop/[id]")
 * @param context - Optional context with customerId, appId, market
 * @returns Object with endTransaction function (no-op since @vercel/otel manages lifecycle)
 */
export function addApmPageContext(
  pagePath: string,
  pageContext?: ApmPageContext
): { endTransaction: (result?: string) => void } {
  const txName = `PAGE ${pagePath}`;

  // Use existing span from @vercel/otel, or create a new one if none exists
  const existingSpan = trace.getActiveSpan();
  const tracer = getTracer();
  const ownsSpan = !existingSpan;
  const span = existingSpan || tracer.startSpan(txName, {
    attributes: { 'span.type': 'page-load' }
  });

  // Update name and attributes
  span.updateName(txName);
  span.setAttribute('span.type', 'page-load');

  if (pageContext) {
    if (pageContext.customerId) {
      span.setAttribute('cid', pageContext.customerId);
      span.setAttribute('enduser.id', pageContext.customerId);
    }
    if (pageContext.appId) {
      span.setAttribute('appId', pageContext.appId);
    }
    if (pageContext.market) {
      span.setAttribute('market', pageContext.market);
    }
  }

  return {
    endTransaction: (result?: string) => {
      if (result) {
        span.setAttribute('page.result', result);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      // Only end spans we created ourselves; @vercel/otel manages its own span lifecycle
      if (ownsSpan) {
        span.end();
      }
      debugLog('Page span completed:', txName, '->', result || 'success', ownsSpan ? '(ended)' : '(not ended - vercel/otel)');
    }
  };
}

/**
 * Extract market from cookie string
 * Used to add market attribute to spans
 */
export function getMarketFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  try {
    const match = cookieHeader.match(/market=([^;]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract currency from cookie string
 */
export function getCurrencyFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  try {
    const match = cookieHeader.match(/currency=([^;]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get customer ID from headers using lightweight token decode
 * Used by instrumentPageRequest to add cid attribute to page spans
 */
interface HeaderAuthInfo {
  cid?: string;
  auth?: string;
}

async function getAuthInfoFromHeaders(headersList: ReadonlyHeaders): Promise<HeaderAuthInfo | null> {
  try {
    const cookieHeader = headersList.get('cookie');
    const authHeader = headersList.get('authorization');

    let token: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (authHeader?.includes('sso-jwt ')) {
      token = authHeader.split('sso-jwt ')[1];
    }

    if (!token && cookieHeader) {
      const match = cookieHeader.match(/auth_idp=([^;]+)/);
      token = match ? match[1] : null;
    }

    if (!token) {
      debugLog('getAuthInfoFromHeaders: No auth token found');
      return null;
    }

    const claims = decodeTokenPayload(token);

    if (claims) {
      debugLog('getAuthInfoFromHeaders: Got claims', { cid: claims.cid, auth: claims.auth });
      return {
        cid: claims.cid,
        auth: claims.auth
      };
    }

    debugLog('getAuthInfoFromHeaders: No claims in decoded payload');
    return null;
  } catch (e) {
    debugLog('getAuthInfoFromHeaders error:', e);
    return null;
  }
}

/**
 * Add context using Next.js headers() function
 * Call from Server Components that have access to headers
 */
export function addApmContextFromHeaders(
  headersList: ReadonlyHeaders,
  pageContext?: ApmPageContext
): void {
  const span = getActiveSpan();
  if (!span) return;

  try {
    const cookieHeader = headersList.get('cookie');
    const market = getMarketFromCookie(cookieHeader);
    if (market) {
      span.setAttribute('market', market);
    }

    if (pageContext?.customerId) {
      span.setAttribute('cid', pageContext.customerId);
      span.setAttribute('enduser.id', pageContext.customerId);
    }
    if (pageContext?.appId) {
      span.setAttribute('appId', pageContext.appId);
    }
    if (pageContext?.market) {
      span.setAttribute('market', pageContext.market);
    }
  } catch (e) {
    debugLog('addApmContextFromHeaders error:', e);
  }
}

/**
 * Sanitize user-controlled `site_location` parameter before adding it to telemetry.
 * - Trims whitespace
 * - Clamps to a small max length
 * - Restricts characters to a safe subset to avoid leaking arbitrary URLs/PII
 */
function sanitizeSiteLocation(raw: string | null): string | null {
  const MAX_SITE_LOCATION_LENGTH = 64;
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  // Clamp length to avoid large/unique values in telemetry backends
  const clamped = trimmed.slice(0, MAX_SITE_LOCATION_LENGTH);
  // Allow only a conservative character set; replace others with "_"
  const safe = clamped.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || null;
}
/**
 * Instrument a page request for OpenTelemetry tracking
 * Call this from root layout to instrument all page requests
 *
 * @param headersList - Next.js headers() result
 */
export async function instrumentPageRequest(headersList: ReadonlyHeaders): Promise<void> {
  if (typeof window !== 'undefined') {
    return;
  }

  try {
    // Get request path from headers using multiple fallbacks
    const xInvokePath = headersList.get('x-invoke-path');
    const xMatchedPath = headersList.get('x-matched-path');
    const xUrl = headersList.get('x-url');
    const referer = headersList.get('referer');
    let pathname = xInvokePath
      || xMatchedPath
      || (xUrl ? xUrl.split('?')[0] : null)
      || (referer ? referer.replace(/^https?:\/\/[^/]+/, '').split('?')[0] : null)
      || '/';

    if (pathname.includes('?')) {
      pathname = pathname.split('?')[0];
    }

    // Skip API routes - they're handled by withCustomerAuth or withApmRoute
    if (pathname.startsWith('/api/')) {
      return;
    }

    // Skip static assets
    if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') {
      return;
    }

    const txName = `PAGE ${pathname}`;

    // Update existing span from @vercel/otel - don't create new spans
    const existingSpan = trace.getActiveSpan();

    if (existingSpan) {
      existingSpan.updateName(txName);
      existingSpan.setAttribute('span.type', 'page-load');
      debugLog('instrumentPageRequest: Updated existing span:', txName);
    } else {
      debugLog('instrumentPageRequest: No active span for:', txName);
    }

    // Add market from cookie
    const cookieHeader = headersList.get('cookie');
    const market = getMarketFromCookie(cookieHeader);
    if (market) {
      setApmLabel('market', market);
    }

    // Add customer context if auth token present
    const authInfo = await getAuthInfoFromHeaders(headersList);
    if (authInfo?.cid) {
      setApmCustomerId(authInfo.cid);
      setApmUserContext(authInfo.cid);
      debugLog('instrumentPageRequest: Set customer context:', authInfo.cid);
    }

    // Set delegated label for employee-to-shopper impersonation
    if (authInfo?.auth === 'e2s') {
      setApmLabel('delegated', true);
      debugLog('instrumentPageRequest: Set delegated label (e2s auth)');
    }

    // Capture site_location query param for redirect source tracking.
    // Prefer x-url and fall back to referer when x-url is unavailable.
    const rawUrl = xUrl || referer;
     if (rawUrl) {
       try {
         const url =
           rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
             ? new URL(rawUrl)
             : new URL(rawUrl, 'http://localhost');
         const rawSiteLocation = url.searchParams.get('site_location');
         const siteLocation = sanitizeSiteLocation(rawSiteLocation);
         if (siteLocation) {
           setApmLabel('site_location', siteLocation);
           debugLog('instrumentPageRequest: Set site_location:', siteLocation);
         }
       } catch {
         // Ignore malformed URLs in headers
      }
    }
  } catch (e) {
    debugLog('instrumentPageRequest error:', e);
  }
}
