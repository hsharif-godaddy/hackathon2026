import { NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';

/**
 * Handle errors from control plane adapter
 * Converts errors with status codes to appropriate NextResponse
 *
 * @param error - Error from adapter
 * @param operation - Operation name for logging
 * @returns NextResponse with appropriate status code
 */
export function handleControlPlaneError(error: unknown, operation: string): NextResponse {
  // Check if error has a status property (works with AiroHttpError or any error with status)
  const hasStatus = error && typeof error === 'object' && 'status' in error;

  if (hasStatus) {
    const status = (error as any).status;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Auth errors: return same status code so client-side authFetch can redirect.
    // 401s from downstream (e.g. mgmt-airo / frontdoor level-3 HBI rejection)
    // are surfaced with authReason: 2 so the client's AuthBoundary / SSO Deck
    // flow picks them up the same way a BFF-side level-3 rejection would.
    if (status === 401 || status === 403) {
      logger.warn(`control-plane.${operation}.auth-error`, {
        message: `Auth error - returning ${status} for client-side redirect`,
        status,
        errorMessage
      }, {
        tags: ['security']
      });

      return NextResponse.json(
        status === 401
          ? { error: 'Unauthorized', authReason: 2 }
          : { error: 'Forbidden' },
        { status }
      );
    }

    // 404 errors
    if (status === 404) {
      logger.info(`control-plane.${operation}.not-found`, {
        message: 'Resource not found',
        status,
        errorMessage
      });

      return NextResponse.json(
        { error: 'Resource not found' },
        { status: 404 }
      );
    }

    // Other HTTP errors
    logger.error(`control-plane.${operation}.http-error`, {
      message: `HTTP error`,
      status,
      errorMessage
    });

    return NextResponse.json(
      { error: errorMessage || 'Request failed' },
      { status }
    );
  }

  // Generic errors without status code
  logger.error(`control-plane.${operation}.error`, {
    message: 'Operation failed',
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
    errorStack: error instanceof Error ? error.stack : undefined
  });

  return NextResponse.json(
    {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    },
    { status: 500 }
  );
}
