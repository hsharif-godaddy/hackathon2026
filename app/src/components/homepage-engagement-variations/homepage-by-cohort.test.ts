import { describe, expect, it } from 'vitest'

import {
  COHORT_IDS,
  homepageComponentForCohort,
} from '@/components/homepage-engagement-variations/homepage-by-cohort'
import { LightHomepageHomePage } from '@/components/homepage-engagement-variations/light_homepage/HomePage'
import { OriginalHomePage } from '@/components/homepage-engagement-variations/original/HomePage'
import { INELIGIBLE_COHORT } from '@/config/experiments'

describe('homepageComponentForCohort', function homepageComponentForCohortSuite() {
  it('uses original for original and ineligible cohorts', function original() {
    expect(homepageComponentForCohort(COHORT_IDS.HOMEPAGE_ENGAGEMENT_ORIGINAL_COHORT)).toBe(OriginalHomePage)
    expect(homepageComponentForCohort(INELIGIBLE_COHORT)).toBe(OriginalHomePage)
  })

  it('uses light homepage for light_homepage cohort', function lightHomepage() {
    expect(homepageComponentForCohort(COHORT_IDS.LIGHT_HOMEPAGE_COHORT_ID)).toBe(LightHomepageHomePage)
  })

  it('uses original for unknown cohort', function unknown() {
    expect(homepageComponentForCohort('future-arm')).toBe(OriginalHomePage)
  })
})
