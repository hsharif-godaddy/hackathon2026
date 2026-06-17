import { useEffect, useRef } from 'react';

import { usePublishUpsellEligibility } from '@/hooks/usePublishUpsellEligibility';
import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';

/**
 * Fires the aab_combine_upgrade_with_publish experiment trigger/exposure event once per app load,
 * for BOTH cohorts, when the user is experiment-eligible. Mounted exactly once on the develop page
 * so it is independent of how many AppPublish instances exist and fires for off-cohort mobile users
 * (where AppPublish is not mounted). Keyed on appId: switching apps in-place re-fires (a new landing).
 */
export function useCombinePublishTrigger(appId: string | undefined): void {
  const { isExperimentEligible } = usePublishUpsellEligibility();
  const firedForAppRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isExperimentEligible || !appId) return;
    if (firedForAppRef.current === appId) return;
    firedForAppRef.current = appId;
    logImpressionEvent('develop.combine_publish.trigger', { appId })();
    shipAnalyticsLog('develop.combine_publish.trigger', { appId });
  }, [isExperimentEligible, appId]);
}
