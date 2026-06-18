import { useEffect, useRef } from 'react';

import { EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments';
import { useHivemind } from '@/hooks/useHivemind';
import { usePublishUpsellEligibility } from '@/hooks/usePublishUpsellEligibility';
import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';

/**
 * Fires the aab_combine_upgrade_with_publish experiment trigger/exposure event once per app load,
 * for BOTH cohorts, when the user is experiment-eligible. Mounted exactly once on the develop page
 * so it is independent of how many AppPublish instances exist and fires for off-cohort mobile users
 * (where AppPublish is not mounted). Keyed on appId: switching apps in-place re-fires (a new landing).
 *
 * The cohort (`on`/`off`) is attached to both events so the two arms can be distinguished in
 * analytics without joining against Hivemind exposure data. The event only fires when eligible
 * (cohort is `on` or `off`), so the `INELIGIBLE_COHORT` fallback is a type guard, not a real value.
 */
export function useCombinePublishTrigger(appId: string | undefined): void {
  const { isExperimentEligible } = usePublishUpsellEligibility();
  const { cohort } = useHivemind(EXPERIMENT_IDS.combineUpgradeWithPublish);
  const firedForAppRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isExperimentEligible || !appId) return;
    if (firedForAppRef.current === appId) return;
    firedForAppRef.current = appId;
    const cohortValue = cohort ?? INELIGIBLE_COHORT;
    logImpressionEvent('develop.combine_publish.trigger', { appId, cohort: cohortValue })();
    shipAnalyticsLog('develop.combine_publish.trigger', { appId, cohort: cohortValue });
  }, [isExperimentEligible, appId, cohort]);
}
