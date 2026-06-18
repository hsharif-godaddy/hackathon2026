import { useEffect } from 'react';

import { DkimErrorCode } from '@/lib/dkim/types';
import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';

const RETRY_DELAY_MS = 3 * 60 * 1000;

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

    const onboard = async (): Promise<{ ok: boolean; retryable: boolean }> => {
      try {
        const res = await appFetch(`/api/apps/${appId}/dkim/onboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        });
        if (!res.ok) {
          // 5xx and 429 are always transient. 404/409 with DOMAIN_NOT_READY means
          // mgmt-hosting hasn't propagated the freshly-attached domain yet — also
          // transient and explicitly marked retryable by the server. All other 4xx
          // (403 domain-not-attached, 400 bad-request) are permanent.
          const body = await res.json().catch(() => null) as { code?: string } | null;
          const retryable =
            res.status >= 500 ||
            res.status === 429 ||
            body?.code === DkimErrorCode.DOMAIN_NOT_READY;
          shipAnalyticsLog('dkim.auto-onboard.failed', { appId, domain, status: res.status, code: body?.code, retryable });
          return { ok: false, retryable };
        }
        return { ok: true, retryable: false };
      } catch (err: unknown) {
        shipAnalyticsLog('dkim.auto-onboard.failed', {
          appId,
          domain,
          error: err instanceof Error ? err.message : String(err),
          retryable: true,
        });
        return { ok: false, retryable: true };
      }
    };

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void onboard().then(({ ok, retryable }) => {
      if (ok || !retryable || cancelled) return;
      retryTimer = setTimeout(() => {
        if (!cancelled) void onboard();
      }, RETRY_DELAY_MS);
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, appId, domain]);
}
