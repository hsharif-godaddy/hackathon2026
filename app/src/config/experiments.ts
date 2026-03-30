/**
 * Hivemind experiment IDs. Single source of truth for A/B and engagement experiments.
 */
export const EXPERIMENT_IDS = {
  homepageEngagement: 'airo-app-builder-homepage-engagement',
} as const

/** Hivemind cohort id for the light homepage engagement arm (matches `light_homepage/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_LIGHT_COHORT = 'light_homepage' as const

export const INELIGIBLE_COHORT = 'ineligible' as const
