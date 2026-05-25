import { useEffect, useRef } from 'react';

import { appFetch } from '@/lib/gasket-config';
import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';

export interface UseDkimAutoOnboardInput {
  appId: string | null | undefined;
  domain: string | null | undefined;
  ownership: AiroDomainDnsOwnershipResponse | null | undefined;
  enabled: boolean;
}

// Cap the per-key retry budget to avoid thundering-herd when ownership
// data flips repeatedly under flaky upstream. Three attempts per
// (appId, domain) covers a transient blip without loading Vox.
const MAX_RETRIES_PER_KEY = 3;

/**
 * Auto-trigger DKIM onboarding when a domain becomes verified-attached
 * and is GoDaddy-DNS-hosted (INTERNAL).
 *
 * IMPORTANT: this hook's dedup state (`attemptsRef`) is per component
 * instance — it resets every time the parent component mounts. We rely
 * on Vox's onboarding being idempotent: re-calling /onboard for an
 * already-onboarded domain is a no-op refresh, not a duplicate
 * provisioning. If that contract changes, this hook would need to
 * persist its dedup set across mounts (e.g. localStorage keyed by
 * appId+domain) to avoid duplicate onboards on each page load.
 *
 * The retry-budget cap (MAX_RETRIES_PER_KEY) bounds a sustained-failure
 * loop within a single mount; the parent's re-mount cycle is the only
 * way to "reset" the budget.
 */
export function useDkimAutoOnboard({ appId, domain, ownership, enabled }: UseDkimAutoOnboardInput): void {
  // Track per-key attempt count so a sustained-error path stops re-firing
  // once we've burned the retry budget. The previous version deleted the
  // dedup key on every error, which allowed unbounded retries any time
  // the parent re-rendered with re-evaluated ownership.
  const attemptsRef = useRef(new Map<string, number>());
  const isGoDaddyDns = ownership?.isGoDaddyDns ?? false;

  useEffect(() => {
    if (!enabled || !appId || !domain || !isGoDaddyDns) return;

    const key = `${appId}:${domain}`;
    const attempts = attemptsRef.current.get(key) ?? 0;
    if (attempts >= MAX_RETRIES_PER_KEY) return;
    attemptsRef.current.set(key, attempts + 1);

    void appFetch(`/api/apps/${appId}/dkim/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    }).then(
      (res) => {
        // 2xx — onboarded (or skipped). Pin the retry counter so we don't
        // re-fire on subsequent renders with the same deps.
        if (res.ok) {
          attemptsRef.current.set(key, MAX_RETRIES_PER_KEY);
        }
      },
      (err: unknown) => {
        // Surface the failure — silent catch made flaky upstream invisible.
        // Console-level (not logger) because this runs in the browser.
         
        console.warn('dkim.auto-onboard.failed', {
          appId,
          domain,
          attempts: attempts + 1,
          maxRetries: MAX_RETRIES_PER_KEY,
          error: err instanceof Error ? err.message : String(err),
        });
        // Don't pin — let a future render retry up to the budget.
      },
    );
  }, [enabled, appId, domain, isGoDaddyDns]);
}
