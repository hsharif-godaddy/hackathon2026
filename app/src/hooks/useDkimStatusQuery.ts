import { useQuery } from '@tanstack/react-query';

import type { DkimStatusResponse } from '@/lib/dkim/types';
import { appFetch } from '@/lib/gasket-config';

/**
 * Maximum number of refetch attempts before the polling loop terminates.
 *
 * 80 attempts × 30s interval = 40 minutes of polling. Beyond that we stop
 * regardless of dkimValid state, on the assumption that something is wrong
 * (DNS propagation stuck, mail-flow outage, Vox provisioning stalled, etc.)
 * and the user needs to take action manually rather than stare at a
 * "DKIM pending" badge forever.
 *
 * This cap is a generic stuck-state guard — it fires for any domain whose
 * dkimValid never transitions to true within the window, regardless of origin.
 */
const MAX_POLL_ATTEMPTS = 80;

const POLL_INTERVAL_MS = 30_000;

async function fetchDkimStatus(appId: string, domain: string): Promise<DkimStatusResponse> {
  const res = await appFetch(
    `/api/apps/${appId}/dkim/status?domain=${encodeURIComponent(domain)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`DKIM status fetch failed: ${res.status}`);
  return res.json() as Promise<DkimStatusResponse>;
}

/**
 * React Query hook for DKIM status polling.
 *
 * Polls the DKIM status endpoint every 30s and stops on the FIRST of:
 *   - dkimValid === true (DNS propagated, all good)
 *   - dataUpdateCount >= MAX_POLL_ATTEMPTS (40 minutes elapsed, stuck-state cap)
 *
 * After the cap the last result sticks visually but network traffic stops.
 * Consumers that want to distinguish "still loading" from "gave up" can read
 * `query.state.dataUpdateCount` or inspect `isError` / `isPending`.
 */
export function useDkimStatusQuery(
  appId: string | null,
  domain: string | null,
): ReturnType<typeof useQuery<DkimStatusResponse, Error>> {
  return useQuery({
    queryKey: ['dkim-status', appId, domain],
    queryFn: () => fetchDkimStatus(appId!, domain!),
    enabled: Boolean(appId && domain),
    refetchInterval: (query) => {
      if (query.state.data?.dkimValid) return false;
      if (query.state.dataUpdateCount >= MAX_POLL_ATTEMPTS) return false;
      return POLL_INTERVAL_MS;
    },
    staleTime: 5_000,
  });
}
