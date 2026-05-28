import { describe, expect, it } from 'vitest'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { AbstractAnimationHomePage } from '@/experiments/homepage-engagement-variations/abstract_animation/HomePage'
import { BuildForFreeHomePage } from '@/experiments/homepage-engagement-variations/build_for_free/HomePage'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { GenerateHomePage } from '@/experiments/homepage-engagement-variations/generate/HomePage'
import { HeroContentImprovementHomePage } from '@/experiments/homepage-engagement-variations/hero_content_improvement/HomePage'
import { homepageComponentForCohort } from '@/experiments/homepage-engagement-variations/homepage-by-cohort'
import { LetsBuildItHomePage } from '@/experiments/homepage-engagement-variations/lets_build_it/HomePage'
import { LetsGoHomePage } from '@/experiments/homepage-engagement-variations/lets_go/HomePage'
import { LightHomepageHomePage } from '@/experiments/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/experiments/homepage-engagement-variations/original/HomePage'
import { StartBuildingHomePage } from '@/experiments/homepage-engagement-variations/start_building/HomePage'
import { StartBuildingForFreeHomePage } from '@/experiments/homepage-engagement-variations/start_building_for_free/HomePage'
import { StartForFreeHomePage } from '@/experiments/homepage-engagement-variations/start_for_free/HomePage'

describe('homepageComponentForCohort', function homepageComponentForCohortSuite() {
  it('uses original for original and ineligible cohorts', function original() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.ORIGINAL)).toBe(OriginalHomePage)
    expect(homepageComponentForCohort(INELIGIBLE_COHORT)).toBe(OriginalHomePage)
  })

  it('uses hero content improvement homepage for hero_content_improvement cohort', function heroContent() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.HERO_CONTENT_IMPROVEMENT)).toBe(HeroContentImprovementHomePage)
  })

  it('uses light homepage for light_homepage cohort', function lightHomepage() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE)).toBe(LightHomepageHomePage)
  })

  it('uses abstract animation homepage for abstract_animation cohort', function abstractAnimation() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.ABSTRACT_ANIMATION)).toBe(AbstractAnimationHomePage)
  })

  it('uses lets build it homepage for lets_build_it cohort', function letsBuildIt() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.LETS_BUILD_IT)).toBe(LetsBuildItHomePage)
  })

  it('uses start building homepage for start_building cohort', function startBuilding() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_BUILDING)).toBe(StartBuildingHomePage)
  })

  it('uses lets go homepage for lets_go cohort', function letsGo() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.LETS_GO)).toBe(LetsGoHomePage)
  })

  it('uses generate homepage for generate cohort', function generate() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.GENERATE)).toBe(GenerateHomePage)
  })

  it('uses build for free homepage for build_for_free cohort', function buildForFree() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.BUILD_FOR_FREE)).toBe(BuildForFreeHomePage)
  })

  it('uses start for free homepage for start_for_free cohort', function startForFree() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_FOR_FREE)).toBe(StartForFreeHomePage)
  })

  it('uses start building for free homepage for start_building_for_free cohort', function startBuildingForFree() {
    expect(homepageComponentForCohort(HOMEPAGE_ENGAGEMENT_COHORT_IDS.START_BUILDING_FOR_FREE)).toBe(StartBuildingForFreeHomePage)
  })

  it('uses original for unknown cohort', function unknown() {
    expect(homepageComponentForCohort('future-arm')).toBe(OriginalHomePage)
  })
})
