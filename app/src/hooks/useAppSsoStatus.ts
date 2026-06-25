'use client';

import { useEffect, useState } from 'react';

import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

/**
 * Module-level subscriber set so a successful Save in SsoPanel propagates
 * to every other consumer of `useAppSsoStatus(appId)` (e.g. AppPublish's
 * publish-button gate, ShareLink's gate). Each hook instance has its own
 * `useState` cell, so a single per-instance `refresh()` would only re-fetch
 * for the calling component. With this, all hook instances scoped to the
 * same appId re-fetch immediately after a save — publish button enables
 * without a page reload.
 */
type SsoStatusListener = (appId: string) => void;
const ssoStatusListeners = new Set<SsoStatusListener>();

export function refreshAppSsoStatus(appId: string): void {
  for (const fn of ssoStatusListeners) fn(appId);
}

/**
 * Reads the per-app Auth-at-Edge SSO state for UI gating.
 *
 * - `ssoRequired` + `ssoConfigId` come from the existing app/site GET
 *   (`SiteInfo.ssoRequired`, `SiteInfo.ssoConfigId`) — admin-controlled in
 *   mhp-core via `apps.sso_required`. No new BFF endpoint needed.
 * - `ssoConfigured` reflects whether the customer has saved their Client ID
 *   + Client Secret yet — i.e. whether BOTH credential pointer rows are
 *   present in airo-go's customer-proxy `auth` group (names resolved per-
 *   config from `SiteInfo.clientIdSecretName` / `clientSecretSecretName`,
 *   mhp-core PR #738). NOT a check on the `SSO_OAUTH_CONFIG` cache row.
 *   The BFF exposes a thin GET at `/api/apps/{id}/sso-config/status` that
 *   reads the auth group via the customer's gd-auth JWT (no mTLS). Fail-
 *   safe: any error → `false` so the publish guard stays blocked rather
 *   than falsely unlocking.
 *
 * Returns simple state (no react-query) — the data changes after a save in
 * Settings → SSO, which calls `refresh()` to fire the module-level
 * subscriber set so every hook instance scoped to this appId re-fetches.
 * The surrounding develop-page store handles the site data lifecycle so we
 * don't need our own caching layer for `ssoRequired`/`ssoConfigId`.
 *
 * NOTE on the `appId` argument: this hook reads `ssoRequired`/`ssoConfigId`
 * from the develop-page store's CURRENT site regardless of the `appId` arg —
 * the arg only gates the `/sso-config/status` fetch and the cross-instance
 * refresh subscription. Callers MUST pass `currentAppId` (the develop-page's
 * active app). Passing some other appId returns store-current site fields
 * paired with a status-fetch for the other app, which is almost certainly a
 * bug. There is no enforceable invariant in TypeScript here; this is a
 * convention pinned by the doc.
 */

export interface AppSsoStatus {
  /**
   * Resolved SSO requirement (admin tier + per-app override collapsed).
   * Must be true for the SSO panel to render at all.
   */
  ssoRequired: boolean;
  /** Active SSO config id bound to this app. */
  ssoConfigId: string | null;
  /** Whether the customer has saved both Client ID + Client Secret. */
  ssoConfigured: boolean;
  /**
   * `true` iff the admin tier is `'optional'` — i.e. the customer can flip
   * the per-app override via the toggle UI. `false` when admin has hard-
   * locked SSO on or off; the toggle should be a locked indicator.
   */
  ssoOverrideAllowed: boolean;
  /**
   * The raw per-app override value (true/false/null). Only meaningful when
   * `ssoOverrideAllowed` is true — drives the toggle's checked state. null
   * means "no per-app override; defer to admin tier."
   */
  ssoRequiredOverride: boolean | null;
  /** Loading flag for `ssoConfigured` — true while the status fetch is in flight. */
  isLoading: boolean;
  /** Re-fetch `ssoConfigured` after a save in the SSO panel. */
  refresh: () => void;
}

interface SsoConfigStatusResponse {
  configured?: boolean;
}

export function useAppSsoStatus(appId: string | null | undefined): AppSsoStatus {
  const site = useDevelopPageStore((s) => s.site);
  const ssoRequired = !!site?.ssoRequired;
  const ssoConfigId = site?.ssoConfigId ?? null;
  const ssoOverrideAllowed = !!site?.ssoOverrideAllowed;
  const ssoRequiredOverride =
    site?.ssoRequiredOverride === undefined ? null : site.ssoRequiredOverride;

  const [ssoConfigured, setSsoConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Subscribe to cross-instance refresh signals so a save in SsoPanel updates
  // the publish-button + share-link gates in the same render cycle.
  useEffect(() => {
    if (!appId) return;
    const listener: SsoStatusListener = (id) => {
      if (id === appId) setRefreshTick((t) => t + 1);
    };
    ssoStatusListeners.add(listener);
    return () => {
      ssoStatusListeners.delete(listener);
    };
  }, [appId]);

  useEffect(() => {
    if (!appId || !ssoRequired) {
      // No need to ask hosting — UI doesn't show SSO surface anyway.
      setSsoConfigured(false);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/apps/${appId}/sso-config/status`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as SsoConfigStatusResponse;
        if (!cancelled) setSsoConfigured(!!body.configured);
      })
      .catch((err) => {
        // Fail safe — assume not configured so publish stays gated.
        logger.warn('useAppSsoStatus.fetch-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setSsoConfigured(false);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, ssoRequired, refreshTick]);

  return {
    ssoRequired,
    ssoConfigId,
    ssoConfigured,
    ssoOverrideAllowed,
    ssoRequiredOverride,
    isLoading,
    refresh: () => {
      if (appId) refreshAppSsoStatus(appId);
    },
  };
}
