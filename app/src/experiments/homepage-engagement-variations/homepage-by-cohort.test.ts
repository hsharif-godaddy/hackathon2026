import { describe, expect, it } from 'vitest'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { AbstractAnimationHomePage } from '@/experiments/homepage-engagement-variations/abstract_animation/HomePage'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { HeroContentImprovementHomePage } from '@/experiments/homepage-engagement-variations/hero_content_improvement/HomePage'
import { homepageComponentForCohort } from '@/experiments/homepage-engagement-variations/homepage-by-cohort'
import { LightHomepageHomePage } from '@/experiments/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/experiments/homepage-engagement-variations/original/HomePage'

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

  it('uses original for unknown cohort', function unknown() {
    expect(homepageComponentForCohort('future-arm')).toBe(OriginalHomePage)
  })
})
