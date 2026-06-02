import { useEffect } from 'react';

import { appFetch } from '@/lib/gasket-config';
import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';

const STORAGE_KEY = 'dkim-onboarded';

export interface UseDkimAutoOnboardInput {
  appId: string | null | undefined;
  domain: string | null | undefined;
  ownership: AiroDomainDnsOwnershipResponse | null | undefined;
  enabled: boolean;
}

function getOnboardedRecord(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function setOnboardedRecord(record: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage full or unavailable — degrade silently
  }
}

/**
 * Mark a domain as onboarded in localStorage.
 * Called after a successful onboard POST.
 */
function markOnboarded(appId: string, domain: string): void {
  const record = getOnboardedRecord();
  record[`${appId}:${domain}`] = new Date().toISOString();
  setOnboardedRecord(record);
}

/**
 * Check if a domain has already been onboarded (record exists in localStorage).
 */
function isOnboarded(appId: string, domain: string): boolean {
  const record = getOnboardedRecord();
  return `${appId}:${domain}` in record;
}

/**
 * Remove the onboarded record for a domain.
 * Call this during domain disconnect to allow re-onboarding
 * when the domain is re-attached.
 */
export function clearDkimOnboardRecord(appId: string, domain: string): void {
  const record = getOnboardedRecord();
  delete record[`${appId}:${domain}`];
  setOnboardedRecord(record);
}

/**
 * Auto-trigger DKIM onboarding when a domain becomes verified-attached
 * and is GoDaddy-DNS-hosted (INTERNAL).
 *
 * Uses localStorage to persist onboard state across page refreshes.
 * Only fires the onboard POST if no record exists for the (appId, domain) pair.
 * Call clearDkimOnboardRecord() during domain disconnect to reset.
 */
export function useDkimAutoOnboard({ appId, domain, ownership, enabled }: UseDkimAutoOnboardInput): void {
  const isGoDaddyDns = ownership?.isGoDaddyDns ?? false;

  useEffect(() => {
    if (!enabled || !appId || !domain || !isGoDaddyDns) return;
    if (isOnboarded(appId, domain)) return;

    void appFetch(`/api/apps/${appId}/dkim/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    }).then(
      (res) => {
        if (res.ok) {
          markOnboarded(appId, domain);
        }
      },
      (err: unknown) => {
        console.warn('dkim.auto-onboard.failed', {
          appId,
          domain,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
  }, [enabled, appId, domain, isGoDaddyDns]);
}
