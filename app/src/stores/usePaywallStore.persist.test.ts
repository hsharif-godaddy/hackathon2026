/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { usePaywallStore } from './usePaywallStore';

describe('usePaywallStore persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    usePaywallStore.getState().clearPublishOpenAfterUpgrade();
  });

  it('persists the armed app id to sessionStorage', () => {
    usePaywallStore.getState().armPublishOpenAfterUpgrade('app-1');
    const raw = sessionStorage.getItem('aab-paywall-arm');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.publishOpenAfterUpgradeAppId).toBe('app-1');
  });

  it('persists ONLY the arm, not modal state', () => {
    usePaywallStore.getState().armPublishOpenAfterUpgrade('app-1');
    usePaywallStore.getState().openUpgradeModal('test-source');
    const persisted = JSON.parse(sessionStorage.getItem('aab-paywall-arm') as string).state;
    expect(persisted.publishOpenAfterUpgradeAppId).toBe('app-1');
    expect(typeof persisted.publishOpenAfterUpgradeArmedAt).toBe('number');
    expect(persisted.showUpgradeModal).toBeUndefined();
    expect(persisted.upgradeModalSource).toBeUndefined();
  });

  it('clears the persisted arm on clearPublishOpenAfterUpgrade', () => {
    usePaywallStore.getState().armPublishOpenAfterUpgrade('app-1');
    usePaywallStore.getState().clearPublishOpenAfterUpgrade();
    const persisted = JSON.parse(sessionStorage.getItem('aab-paywall-arm') as string).state;
    expect(persisted.publishOpenAfterUpgradeAppId).toBeNull();
  });

  // This is the case the whole task exists for: a FRESH arm written before the purchase flow
  // must come BACK into the store after the reload. The write-only tests above do not prove this.
  it('rehydrates a fresh arm from sessionStorage on reload', async () => {
    sessionStorage.setItem(
      'aab-paywall-arm',
      JSON.stringify({
        state: { publishOpenAfterUpgradeAppId: 'app-1', publishOpenAfterUpgradeArmedAt: Date.now() },
        version: 0,
      }),
    );
    await usePaywallStore.persist.rehydrate();
    expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-1');
  });

  // The regression the TTL exists for: a stale arm (abandoned purchase, then reloads later) must be
  // dropped on rehydrate so it can never auto-open publish on a later, unrelated paid-state flip.
  it('drops a stale arm (older than the TTL) on rehydrate', async () => {
    sessionStorage.setItem(
      'aab-paywall-arm',
      JSON.stringify({
        state: {
          publishOpenAfterUpgradeAppId: 'app-1',
          publishOpenAfterUpgradeArmedAt: Date.now() - 31 * 60 * 1000,
        },
        version: 0,
      }),
    );
    await usePaywallStore.persist.rehydrate();
    expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBeNull();
  });

  // A legacy arm written before this field existed (or any tampered entry) has no armedAt. Treat it
  // as stale and drop it on rehydrate, same as a TTL-expired arm — never trust an untimestamped arm.
  it('drops a timestamp-less arm on rehydrate', async () => {
    sessionStorage.setItem(
      'aab-paywall-arm',
      JSON.stringify({
        state: { publishOpenAfterUpgradeAppId: 'app-1' },
        version: 0,
      }),
    );
    await usePaywallStore.persist.rehydrate();
    expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBeNull();
  });
});
