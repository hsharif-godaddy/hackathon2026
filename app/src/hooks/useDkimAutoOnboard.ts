import { useEffect } from 'react';

import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';

export interface UseDkimAutoOnboardInput {
  appId: string | null | undefined;
  domain: string | null | undefined;
  enabled: boolean;
}

/**
 * Auto-trigger DKIM onboarding for a domain.
 *
 * The server is the single source of truth: the onboard endpoint claims the
 * domain in the agents DB (compare-and-set) and dedupes, so firing this POST on
 * every mount is safe — a duplicate is a cheap no-op. No client-side state.
 *
 * The origin check (GoDaddy vs external) is enforced server-side; this hook
 * fires for any domain when enabled so that external domains also get DKIM
 * records provisioned once they are attached.
 */
export function useDkimAutoOnboard({ appId, domain, enabled }: UseDkimAutoOnboardInput): void {
  useEffect(() => {
    if (!enabled || !appId || !domain) return;

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
  }, [enabled, appId, domain]);
}
