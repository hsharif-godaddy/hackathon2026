import { useQuery } from '@tanstack/react-query';

import type { DkimStatusResponse } from '@/lib/dkim/types';
import { appFetch } from '@/lib/gasket-config';

const PHASE1_INTERVAL_MS = 30_000;            // 30 s
const MAX_TOTAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface UseDkimStatusQueryExternalOptions {
  durablePolling?: boolean;
}

async function fetchDkimStatus(appId: string, domain: string, durablePolling: boolean): Promise<DkimStatusResponse> {
  const pollingParam = durablePolling ? '&polling=external' : '';
  const res = await appFetch(
    `/api/apps/${appId}/dkim/status?domain=${encodeURIComponent(domain)}${pollingParam}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`DKIM status fetch failed: ${res.status}`);
  return res.json() as Promise<DkimStatusResponse>;
}

/**
 * DKIM status polling hook for external domains.
 *
 * The three-phase schedule (fast → exponential backoff → 24 h/poll) is
 * computed in agents SQLite and returned as `nextPollAt`. This hook follows
 * that shared server timestamp so multiple devices for the same app+domain do
 * not each restart their own polling cadence.
 */
export function useDkimStatusQueryExternal(
  appId: string | null,
  domain: string | null,
  options: UseDkimStatusQueryExternalOptions = {},
): ReturnType<typeof useQuery<DkimStatusResponse, Error>> {
  const durablePolling = options.durablePolling ?? true;

  return useQuery<DkimStatusResponse, Error>({
    queryKey: ['dkim-status-external', appId, domain, durablePolling],
    queryFn: () => fetchDkimStatus(appId!, domain!, durablePolling),
    enabled: Boolean(appId && domain),
    // staleTime matches Phase 1 interval so re-mounting within 30 s doesn't
    // trigger an extra fetch; stale data is still returned instantly.
    staleTime: PHASE1_INTERVAL_MS,
    // Don't refetch on tab focus — rely solely on the scheduled interval.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (!durablePolling) return false;
      if (query.state.data?.dkimValid) return false;
      if (query.state.data?.pollingExpired) return false;

      const nextPollAtStr = query.state.data?.nextPollAt;
      const nextPollAt = nextPollAtStr ? new Date(nextPollAtStr).getTime() : 0;
      if (nextPollAt > 0) {
        return Math.max(nextPollAt - Date.now(), 1_000);
      }

      // Enforce 30-day wall-clock limit using pollStartedAt from agents SQLite
      // (set on first onboard, app+domain scoped, survives page reloads).
      const pollStartedAtStr = query.state.data?.pollStartedAt;
      const startedAt = pollStartedAtStr ? new Date(pollStartedAtStr).getTime() : 0;
      if (startedAt > 0 && Date.now() - startedAt >= MAX_TOTAL_MS) return false;

      return PHASE1_INTERVAL_MS;
    },
  });
}
