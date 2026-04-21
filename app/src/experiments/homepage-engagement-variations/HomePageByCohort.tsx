'use client'

import { EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments'
import { homepageComponentForCohort } from '@/experiments/homepage-engagement-variations/homepage-by-cohort'
import { useHivemind } from '@/hooks/useHivemind'
import type { ServerFeatureFlags } from '@/lib/server-features'

export function HomePageByCohort({ serverFeatures }: { serverFeatures: ServerFeatureFlags }) {
  const { cohort } = useHivemind(EXPERIMENT_IDS.homepageEngagement)
  const HomePage = homepageComponentForCohort(cohort ?? INELIGIBLE_COHORT)

  return <HomePage serverFeatures={serverFeatures} />
}
