import { useCallback, useEffect } from 'react';

import { logger } from '@/lib/request-context';
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore';
import { useBrandData } from './useBrandData';

/**
 * Tracks the Design Kit Wizard phase for an app (AIROBUILD-2679 Phase 2).
 *
 * Hydrates the live `useWizardStore` (updated by `BuildPhaseHandler`) from the
 * persisted `brand.wizard.phase` the first time we learn it, then reflects store
 * updates. Exposes a setter that persists via the BFF and updates the store
 * optimistically.
 */
export function useWizardPhase(appId: string): {
  phase: WizardPhase;
  setPhase: (phase: WizardPhase) => Promise<void>;
  isLoading: boolean;
} {
  const storePhase = useWizardStore((s) => s.phaseByApp[appId]);
  const setStorePhase = useWizardStore((s) => s.setPhase);
  const { data, isLoading } = useBrandData(appId);

  // Hydrate the store from persisted brand-data the first time we learn the phase.
  // Only write once brand-data has actually loaded a phase: writing the 'gathering'
  // default before it loads would satisfy the `=== undefined` guard and then block
  // the real persisted phase from hydrating — throwing a reloaded mid-flow session
  // back to gathering. The returned `phase` already falls back to 'gathering'
  // without needing a store write.
  useEffect(() => {
    const persisted = data?.wizard?.phase;
    if (persisted && useWizardStore.getState().phaseByApp[appId] === undefined) {
      setStorePhase(appId, persisted);
    }
  }, [appId, data?.wizard?.phase, setStorePhase]);

  const setPhase = useCallback(
    async (phase: WizardPhase): Promise<void> => {
      // Capture the persisted value before the optimistic update so we can revert
      // if the PUT fails. Default to 'gathering' (the same fallback the returned
      // `phase` uses).
      const prev = useWizardStore.getState().phaseByApp[appId] ?? 'gathering';
      setStorePhase(appId, phase); // optimistic
      try {
        const res = await fetch(`/api/design-kit/${appId}/wizard-step`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase }),
        });
        if (!res.ok) {
          logger.error('designKit.wizardPhase.save.failed', { appId, phase, status: res.status });
          // Only roll back if our optimistic value is still current. If the agent
          // (or another action) advanced the phase since, writing the now-stale
          // `prev` would transiently flip the visible phase backward.
          if (useWizardStore.getState().phaseByApp[appId] === phase) {
            setStorePhase(appId, prev);
          }
        }
      } catch (err) {
        // Fire-and-forget callers must never see a rejection; revert and log.
        logger.error('designKit.wizardPhase.save.failed', { appId, phase, error: err });
        if (useWizardStore.getState().phaseByApp[appId] === phase) {
          setStorePhase(appId, prev); // rollback only if still our optimistic value
        }
      }
    },
    [appId, setStorePhase],
  );

  return { phase: storePhase ?? 'gathering', setPhase, isLoading };
}
