import { useCallback,useEffect } from 'react';

import { useWizardStore, type WizardStep } from '@/stores/useWizardStore';
import { useBrandData } from './useBrandData';

/**
 * Tracks the Design Kit Wizard step for an app.
 *
 * Hydrates the live `useWizardStore` (updated by `BuildPhaseHandler`) from the
 * persisted `brand.wizard.step` the first time we learn it, then reflects store
 * updates. Exposes a setter that persists via the BFF and updates the store
 * optimistically.
 */
export function useWizardStep(appId: string): {
  step: WizardStep;
  setStep: (step: WizardStep) => Promise<void>;
  isLoading: boolean;
} {
  const storeStep = useWizardStore((s) => s.stepByApp[appId]);
  const setStoreStep = useWizardStore((s) => s.setStep);
  const { data, isLoading } = useBrandData(appId);

  // Hydrate the store from persisted brand-data the first time we learn the step.
  useEffect(() => {
    const persisted = data?.wizard?.step as WizardStep | undefined;
    if (persisted && useWizardStore.getState().stepByApp[appId] === undefined) {
      setStoreStep(appId, persisted);
    }
  }, [appId, data?.wizard?.step, setStoreStep]);

  const setStep = useCallback(
    async (step: WizardStep): Promise<void> => {
      // Capture the persisted value before the optimistic update so we can revert
      // if the PUT fails. Default to 1 (the same fallback the returned `step` uses).
      const prev = (useWizardStore.getState().stepByApp[appId] ?? 1) as WizardStep;
      setStoreStep(appId, step); // optimistic
      try {
        const res = await fetch(`/api/design-kit/${appId}/wizard-step`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step }),
        });
        if (!res.ok) {
          console.error('designKit.wizardStep.save.failed', { appId, step, status: res.status });
          // Only roll back if our optimistic value is still current. If the agent
          // (or another action) advanced the step since, writing the now-stale
          // `prev` would transiently flip the visible stepper backward.
          if (useWizardStore.getState().stepByApp[appId] === step) {
            setStoreStep(appId, prev);
          }
        }
      } catch (err) {
        // Fire-and-forget callers must never see a rejection; revert and log.
        console.error('designKit.wizardStep.save.failed', { appId, step, error: err });
        if (useWizardStore.getState().stepByApp[appId] === step) {
          setStoreStep(appId, prev); // rollback only if still our optimistic value
        }
      }
    },
    [appId, setStoreStep],
  );

  return { step: (storeStep ?? 1) as WizardStep, setStep, isLoading };
}
