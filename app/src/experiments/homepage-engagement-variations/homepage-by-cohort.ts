import type { ComponentType } from 'react'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { AbstractAnimationHomePage } from '@/experiments/homepage-engagement-variations/abstract_animation/HomePage'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { HeroContentImprovementHomePage } from '@/experiments/homepage-engagement-variations/hero_content_improvement/HomePage'
import { LightHomepageHomePage } from '@/experiments/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/experiments/homepage-engagement-variations/original/HomePage'
import type { ServerFeatureFlags } from '@/lib/server-features'

type HomePageComponent = ComponentType<{ serverFeatures: ServerFeatureFlags }>

const homepageByCohort = new Map<string, HomePageComponent>([
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.ABSTRACT_ANIMATION, AbstractAnimationHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.HERO_CONTENT_IMPROVEMENT, HeroContentImprovementHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.ORIGINAL, OriginalHomePage],
  [INELIGIBLE_COHORT, OriginalHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE, LightHomepageHomePage],
])

export function homepageComponentForCohort(cohort: string): HomePageComponent {
  return homepageByCohort.get(cohort) ?? OriginalHomePage
}
