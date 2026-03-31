import { describe, expect, it } from 'vitest'

import { INELIGIBLE_COHORT } from '@/config/experiments'
import { HeroContentImprovementHomePage } from '@/experiments/homepage-engagement-variations/hero_content_improvement/HomePage'
import {
  COHORT_IDS,
  homepageComponentForCohort,
} from '@/experiments/homepage-engagement-variations/homepage-by-cohort'
import { LightHomepageHomePage } from '@/experiments/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/experiments/homepage-engagement-variations/original/HomePage'

describe('homepageComponentForCohort', function homepageComponentForCohortSuite() {
  it('uses original for original and ineligible cohorts', function original() {
    expect(homepageComponentForCohort(COHORT_IDS.HOMEPAGE_ENGAGEMENT_ORIGINAL_COHORT)).toBe(OriginalHomePage)
    expect(homepageComponentForCohort(INELIGIBLE_COHORT)).toBe(OriginalHomePage)
  })

  it('uses hero content improvement homepage for hero_content_improvement cohort', function heroContent() {
    expect(homepageComponentForCohort(COHORT_IDS.HERO_CONTENT_IMPROVEMENT_COHORT_ID)).toBe(HeroContentImprovementHomePage)
  })

  it('uses light homepage for light_homepage cohort', function lightHomepage() {
    expect(homepageComponentForCohort(COHORT_IDS.LIGHT_HOMEPAGE_COHORT_ID)).toBe(LightHomepageHomePage)
  })

  it('uses original for unknown cohort', function unknown() {
    expect(homepageComponentForCohort('future-arm')).toBe(OriginalHomePage)
  })
})
