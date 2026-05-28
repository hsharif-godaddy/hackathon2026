import type { ComponentType } from 'react'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { AbstractAnimationHomePage } from '@/experiments/homepage-engagement-variations/abstract_animation/HomePage'
import { BuildForFreeHomePage } from '@/experiments/homepage-engagement-variations/build_for_free/HomePage'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { GenerateHomePage } from '@/experiments/homepage-engagement-variations/generate/HomePage'
import { HeroContentImprovementHomePage } from '@/experiments/homepage-engagement-variations/hero_content_improvement/HomePage'
import { LetsBuildItHomePage } from '@/experiments/homepage-engagement-variations/lets_build_it/HomePage'
import { LetsGoHomePage } from '@/experiments/homepage-engagement-variations/lets_go/HomePage'
import { LightHomepageHomePage } from '@/experiments/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/experiments/homepage-engagement-variations/original/HomePage'
import { StartBuildingHomePage } from '@/experiments/homepage-engagement-variations/start_building/HomePage'
import { StartBuildingForFreeHomePage } from '@/experiments/homepage-engagement-variations/start_building_for_free/HomePage'
import { StartForFreeHomePage } from '@/experiments/homepage-engagement-variations/start_for_free/HomePage'
import type { ServerFeatureFlags } from '@/lib/server-features'

type HomePageComponent = ComponentType<{ serverFeatures: ServerFeatureFlags }>

const homepageByCohort = new Map<string, HomePageComponent>([
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.ABSTRACT_ANIMATION, AbstractAnimationHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.HERO_CONTENT_IMPROVEMENT, HeroContentImprovementHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.ORIGINAL, OriginalHomePage],
  [INELIGIBLE_COHORT, OriginalHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE, LightHomepageHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.LETS_BUILD_IT, LetsBuildItHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_BUILDING, StartBuildingHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.LETS_GO, LetsGoHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.GENERATE, GenerateHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.BUILD_FOR_FREE, BuildForFreeHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_FOR_FREE, StartForFreeHomePage],
  [HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_BUILDING_FOR_FREE, StartBuildingForFreeHomePage],
])

export function homepageComponentForCohort(cohort: string): HomePageComponent {
  return homepageByCohort.get(cohort) ?? OriginalHomePage
}
