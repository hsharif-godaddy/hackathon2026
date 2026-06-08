/**
 * Client-Side Logging Module
 *
 * Provides structured logging for client-side code with automatic
 * environment-aware behavior:
 * - Development: Console output for debugging
 * - Production: Batched shipping to Elasticsearch via /api/client-logs
 *
 * @example
 * ```typescript
 * import { ClientLogBuffer, shipAnalyticsLog } from '@/lib/logging';
 *
 * // Initialize once at app startup (e.g., in _app.tsx or layout.tsx)
 * ClientLogBuffer.init();
 *
 * // Logs are automatically buffered and shipped
 * // Manual flush if needed:
 * await ClientLogBuffer.flush();
 *
 * // For analytics events (batched for efficiency):
 * shipAnalyticsLog('airoplus.purchase.in-app', { appId, domain });
 * ```
 */

import { logger } from '@/lib/request-context';
import { getInstrumentationAppId, getSharedInstrumentationContext, normalizedAppId } from '@/utils/instrumentation';
import { ClientLogBuffer } from './client-log-buffer';

export { ClientLogBuffer };
export type { ClientLogBufferConfig } from './client-log-buffer';

/**
 * Merges instrumentation context into analytics payloads (Elasticsearch channel).
 *
 * appId precedence:
 *  1. Module value (getInstrumentationAppId) — UUID-rejected at write time
 *  2. Caller-supplied data.appId — normalized here; UUID → dropped
 *  Conflict → module value wins + warning logged.
 *
 * Context fields (entry_point, plan_type, etc.) come from getSharedInstrumentationContext,
 * which is also used by the CSP channel — both channels stay in sync automatically.
 */
export function mergeAnalyticsContext(data: Record<string, unknown>): Record<string, unknown> {
  const moduleAppId = getInstrumentationAppId();

  // Normalize caller-supplied appId the same way mergeContext does — UUID → dropped
  const rawCallerAppId = data.appId;
  const callerAppId = typeof rawCallerAppId === 'string' ? normalizedAppId(rawCallerAppId) : undefined;

  if (moduleAppId && callerAppId && moduleAppId !== callerAppId) {
    logger.warn('logging.mergeAnalyticsContext.appId.conflict', {
      message: 'appId in data differs from instrumentation appId; using instrumentation appId',
      callerAppId,
      currentAppId: moduleAppId,
    });
  }

  const effectiveAppId = moduleAppId ?? callerAppId;
  const { appId: _appId, ...rest } = data;

  const sessionId = ClientLogBuffer.getSessionId();
  const ctx = getSharedInstrumentationContext(rest.intent_category);

  return {
    ...rest,
    ...(effectiveAppId && { appId: effectiveAppId }),
    ...(sessionId && { log_session_id: sessionId }),
    ...ctx,
  };
}

/**
 * Ship an analytics log via the batched ClientLogBuffer
 *
 * Uses the existing batching infrastructure for efficiency and protection:
 * - Batches up to 50 logs before sending
 * - Auto-flushes every 5 seconds
 * - Exponential backoff on failures
 * - Max buffer overflow protection (200 logs)
 * - Flushes on page unload via sendBeacon
 *
 * The server will automatically add customerId, shopperId, and isTLA fields.
 *
 * @param event - Event name (will be prefixed with 'client.' on server)
 * @param data - Event data payload
 *
 * @example
 * ```typescript
 * shipAnalyticsLog('airoplus.purchase.in-app', {
 *   appId: 'abc123',
 *   domain: 'example.com',
 *   source: 'in-app-paywall'
 * });
 * ```
 */
export function shipAnalyticsLog(event: string, data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  // Use batching infrastructure for efficiency and cluster protection
  ClientLogBuffer.add({
    level: 'info',
    event,
    data: {
      ...mergeAnalyticsContext(data),
      source: 'analytics' // Mark as analytics event for filtering
    }
  });
}

