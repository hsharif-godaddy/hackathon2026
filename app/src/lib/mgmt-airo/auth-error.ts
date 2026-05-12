import { NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';
import { AiroHttpError } from './types';

/**
 * Translate a mgmt-airo 401 into the BFF's standard "session needs HBI re-auth"
 * response, which the client's AuthBoundary / SSO Deck flow picks up via
 * authReason: 2.
 *
 * The frontdoor (pioneermgmt) enforces jwt-access-level 3 with
 * use-12hr-strategy on mutating /api/airo/ endpoints. BFF-side
 * withCustomerAuth({ level: 3 }) is a best-effort fast-path — it doesn't
 * perfectly mirror frontdoor, so some tokens pass the BFF check and still
 * get rejected upstream. When that happens we want the same client UX
 * (auto SSO re-prompt) as a BFF-side level-3 rejection, not a generic
 * operation failure.
 *
 * Returns the 401 NextResponse when the error is a mgmt-airo 401; otherwise
 * returns null so callers can fall through to their normal error handling.
 *
 * There is a safety net in withCustomerAuth that catches any AiroHttpError(401)
 * that escapes a route handler and converts it. Call this helper explicitly in
 * your catch block anyway — the safety net uses a generic event name, while an
 * explicit call lets you log a route-specific event and attach context.
 */
export function mgmtAiro401Response(
  error: unknown,
  event: string,
  context: Record<string, unknown> = {}
): NextResponse | null {
  if (!(error instanceof AiroHttpError) || error.status !== 401) {
    return null;
  }

  logger.warn(event, context, { tags: ['security'] });

  return NextResponse.json(
    { error: 'Unauthorized', authReason: 2 },
    { status: 401 }
  );
}
