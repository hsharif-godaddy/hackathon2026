import { useEffect } from 'react';

import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';
import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';

export interface UseDkimAutoOnboardInput {
  appId: string | null | undefined;
  domain: string | null | undefined;
  ownership: AiroDomainDnsOwnershipResponse | null | undefined;
  enabled: boolean;
}

/**
 * Auto-trigger DKIM onboarding when a domain is verified-attached and
 * GoDaddy-DNS-hosted (INTERNAL).
 *
 * The server is the single source of truth: the onboard endpoint claims the
 * domain in the agents DB (compare-and-set) and dedupes, so firing this POST on
 * every mount is safe — a duplicate is a cheap no-op. No client-side state.
 */
export function useDkimAutoOnboard({ appId, domain, ownership, enabled }: UseDkimAutoOnboardInput): void {
  const isGoDaddyDns = ownership?.isGoDaddyDns ?? false;

  useEffect(() => {
    if (!enabled || !appId || !domain || !isGoDaddyDns) return;

    void appFetch(`/api/apps/${appId}/dkim/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    })
      .then((res) => {
        if (!res.ok) {
          console.warn('dkim.auto-onboard.failed', { appId, domain, status: res.status });
          shipAnalyticsLog('dkim.auto-onboard.failed', { appId, domain, status: res.status });
        }
      })
      .catch((err: unknown) => {
        console.warn('dkim.auto-onboard.failed', {
          appId,
          domain,
          error: err instanceof Error ? err.message : String(err),
        });
        shipAnalyticsLog('dkim.auto-onboard.failed', {
          appId,
          domain,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [enabled, appId, domain, isGoDaddyDns]);
}
