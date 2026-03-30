import type { ComponentType } from 'react'

import { LightHomepageHomePage } from '@/components/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/components/homepage-engagement-variations/original/HomePage'
import { HOMEPAGE_ENGAGEMENT_LIGHT_COHORT, INELIGIBLE_COHORT } from '@/config/experiments'
import type { ServerFeatureFlags } from '@/lib/server-features'

export const COHORT_IDS = {
  HOMEPAGE_ENGAGEMENT_ORIGINAL_COHORT: 'original',
  LIGHT_HOMEPAGE_COHORT_ID: HOMEPAGE_ENGAGEMENT_LIGHT_COHORT,
} as const

type HomePageComponent = ComponentType<{ serverFeatures: ServerFeatureFlags }>

const homepageByCohort = new Map<string, HomePageComponent>([
  [COHORT_IDS.HOMEPAGE_ENGAGEMENT_ORIGINAL_COHORT, OriginalHomePage],
  [INELIGIBLE_COHORT, OriginalHomePage],
  [COHORT_IDS.LIGHT_HOMEPAGE_COHORT_ID, LightHomepageHomePage],
])

export function homepageComponentForCohort(cohort: string): HomePageComponent {
  return homepageByCohort.get(cohort) ?? OriginalHomePage
}
