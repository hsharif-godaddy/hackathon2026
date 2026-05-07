'use client'

import { useSearchParams } from 'next/navigation'

import { EXPERIMENT_IDS, INELIGIBLE_COHORT } from '@/config/experiments'
import { homepageComponentForCohort } from '@/experiments/homepage-engagement-variations/homepage-by-cohort'
import { useHivemind } from '@/hooks/useHivemind'
import type { ServerFeatureFlags } from '@/lib/server-features'

export function HomePageByCohort({ serverFeatures }: { serverFeatures: ServerFeatureFlags }) {
  const { cohort } = useHivemind(EXPERIMENT_IDS.homepageEngagement)
  const searchParams = useSearchParams()
  const cohortOverride = searchParams.get('homepage_cohort')
  const effectiveCohort = cohortOverride || cohort || INELIGIBLE_COHORT
  const HomePage = homepageComponentForCohort(effectiveCohort)

  return <HomePage serverFeatures={serverFeatures} />
}
