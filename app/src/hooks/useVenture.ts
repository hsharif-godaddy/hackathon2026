/**
 * Venture Hook
 *
 * Fetches (or creates) the venture ID for the authenticated user.
 */

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { HttpError } from '@/lib/errors';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

const QUERY_KEY = ['venture'] as const;
const STALE_TIME = 5 * 60 * 1000;
const GC_TIME = 10 * 60 * 1000;
const MAX_RETRIES = 3;

interface UseVentureOptions {
  enabled?: boolean;
}

interface UseVentureResult {
  ventureId: string | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

async function fetchVenture(): Promise<{ ventureId: string }> {
  const response = await appFetch('/api/venture', { credentials: 'include' });

  if (!response.ok) {
    throw new HttpError(`Failed to fetch venture: ${response.status}`, response.status);
  }

  const json = await response.json();

  if (!json.success || !json.ventureId) {
    throw new Error(json.error || 'Failed to get venture');
  }

  return { ventureId: json.ventureId };
}

export function useVenture(options: UseVentureOptions = {}): UseVentureResult {
  const { enabled = true } = options;

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchVenture,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled,
    retry(failureCount, error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < MAX_RETRIES;
    },
    retryDelay(attemptIndex) {
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
  });

  const loggedErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    const err = query.error;
    if (!query.isError || !err || loggedErrorRef.current === err) return;
    loggedErrorRef.current = err;
    const status = err instanceof HttpError ? err.status : undefined;
    logger.error('use-venture.fetch-error', {
      message: err.message,
      status,
      failureCount: query.failureCount,
    });
  }, [query.isError, query.error, query.failureCount]);

  return {
    ventureId: query.data?.ventureId,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
