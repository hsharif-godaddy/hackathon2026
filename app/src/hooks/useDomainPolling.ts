import { useRef } from 'react';

import { useAppDetails } from '@/hooks/useAppDetails';
import { DomainStatus } from '@/lib/mgmt-airo/types';

// Domain provisioning can take minutes to hours (DNS propagation up to 48 hrs).
// Back off over time to avoid hammering the API while still detecting resolution promptly early on.
const POLL_STAGES = [
  { after: 0,            interval: 5_000       }, // 0–5 min:   every 5s
  { after: 5 * 60_000,  interval: 30_000      }, // 5–10 min:  every 30s
  { after: 10 * 60_000, interval: 2 * 60_000  }, // 10–60 min: every 2 min
  { after: 60 * 60_000, interval: 10 * 60_000 }, // 1 hr+:     every 10 min
] as const;

function pollInterval(elapsedMs: number): number {
  for (let i = POLL_STAGES.length - 1; i >= 0; i--) {
    if (elapsedMs >= POLL_STAGES[i].after) {
      return POLL_STAGES[i].interval;
    }
  }
  return POLL_STAGES[0].interval;
}

/**
 * Wraps useAppDetails with adaptive polling scoped to domain provisioning state.
 *
 * Polls while any non-prefix domain is in a transitional state:
 * - no status yet (just created)
 * - PENDING / DELETING
 * - CDN INIT or PENDING (only when domain itself is PENDING)
 *
 * Backs off from 5s → 30s → 2min → 10min over time.
 * Clock resets when all domains reach a terminal state.
 */
export function useDomainPolling(appId: string | null | undefined) {
  const pollStartTimeRef = useRef(Date.now());

  return useAppDetails(appId, {
    enabled: !!appId,
    includeCdn: true,
    refetchInterval: (data) => {
      const hasPendingDomain = data?.domains?.some(d => {
        if (d.domainType === 'prefix') return false;
        if (!d.status) return true; // status absent immediately after creation — poll until backend assigns one

        return d.status === DomainStatus.PENDING || d.status === DomainStatus.DELETING;
      }) ?? false;

      if (!hasPendingDomain) {
        pollStartTimeRef.current = Date.now();
        return false;
      }
      return pollInterval(Date.now() - pollStartTimeRef.current);
    },
  });
}
