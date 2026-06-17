'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { usePusher } from '@/hooks/usePusher';
import { queryKeys } from '@/lib/inbox/constants/queryKeys';

// Collapse a burst of autoupdate_version increments into a single invalidation.
const INVALIDATE_DEBOUNCE_MS = 400;

interface UseInboxRealtimeOptions {
  accountId?: string;
}

/**
 * Owns the single Pusher subscription for the builder session. On
 * autoupdate_version events it debounces, then invalidates the root ['reamaze']
 * query key — refetching every mounted inbox query (conversation list, active
 * conversation, messages) and the unresolved-count badge. Call once at the page level.
 *
 * Gated by accountId: pass `undefined` (e.g. when the inbox feature is disabled)
 * and usePusher opens no connection.
 */
export function useInboxRealtime({ accountId }: UseInboxRealtimeOptions): void {
  const queryClient = useQueryClient();
  const invalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleAutoupdate = useCallback(() => {
    if (invalidateTimeoutRef.current) {
      clearTimeout(invalidateTimeoutRef.current);
    }
    invalidateTimeoutRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
    }, INVALIDATE_DEBOUNCE_MS);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
    },
    [],
  );

  usePusher({ accountId, onAutoupdate: handleAutoupdate });
}
