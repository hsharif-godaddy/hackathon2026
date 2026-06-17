import { usePathname } from 'next/navigation';

import { COHORT_OFF, COHORT_ON, EXPERIMENT_IDS } from '@/config/experiments';
import { useHivemind } from '@/hooks/useHivemind';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';

interface PublishUpsellEligibility {
  isExperimentEligible: boolean;
  isTreatment: boolean;
}

/**
 * Single source of truth for the aab_combine_upgrade_with_publish experiment gating.
 *
 * - isExperimentEligible: defines the trigger population (BOTH cohorts) — free, not loading,
 *   not errored, on the Develop page, and bucketed into the experiment.
 * - isTreatment: the `on` cohort subset that sees the upsell popover.
 *
 * Develop-only uses `/develop/` (NOT isBuilderPagePath, which also matches `/commander/`).
 */
export function usePublishUpsellEligibility(): PublishUpsellEligibility {
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop/') ?? false;
  const { showPaywall, isLoading, isError } = usePaywallEligibility();
  const { cohort } = useHivemind(EXPERIMENT_IDS.combineUpgradeWithPublish);

  const inExperiment = cohort === COHORT_ON || cohort === COHORT_OFF;
  const isExperimentEligible =
    isDevelopPage && !isLoading && !isError && showPaywall && inExperiment;
  const isTreatment = isExperimentEligible && cohort === COHORT_ON;

  return { isExperimentEligible, isTreatment };
}
