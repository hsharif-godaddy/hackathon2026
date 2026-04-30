/**
 * Hivemind experiment IDs. Single source of truth for A/B and engagement experiments.
 */
export const EXPERIMENT_IDS = {
  homepageEngagement: 'airo-app-builder-homepage-engagement-2',
  /** UPP / pricing: which paid tier is highlighted as recommended (Professional vs Ultimate) */
  recommendedPlan: 'aab_recommended_plan_uppdcx',
  /** Chat Gauge: whether to show the chat gauge on the develop page */
  chatGauge: 'airo-app-builder-chat-gauge',
  /** Venture Home logo redirect: enable Brand Book for users entering via Venture Home */
  ventureHomeLogo: 'vh_dashboard_logo_to_airo_builder_redirect',
} as const

/** Hivemind cohort id for hero copy, value props, examples intro, and section order (matches `hero_content_improvement/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_HERO_CONTENT_COHORT = 'hero_content_improvement' as const

/** Hivemind cohort id for the light homepage engagement arm (matches `light_homepage/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_LIGHT_COHORT = 'light_homepage' as const

/** Hivemind cohort id for the abstract animation homepage arm (matches `abstract_animation/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_ABSTRACT_ANIMATION_COHORT = 'abstract_animation' as const

export const INELIGIBLE_COHORT = 'ineligible' as const
