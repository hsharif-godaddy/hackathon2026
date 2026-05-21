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
  /** Initial agent selection: maps cohort → agent profile. Only one agent-config experiment should run at a time. */
  initialAgent: 'airo-build-initial-agent',
  /** Build overlay question: show "Action needed" text when askQuestion is pending during initial build */
  buildOverlayQuestion: 'aab_first_build_action_needed_copy',
} as const

/**
 * Maps Hivemind cohorts from the `initialAgent` experiment to agent profile names.
 * Profile names must exist as JSON files in `agents/src/profiles/`.
 *
 * Every cohort participating in the experiment must be listed here with an explicit
 * profile so the experiment is immune to changes in the `appbuilder-agent-profile`
 * switchboard default. Cohorts not in this map (`ineligible`, `unassigned`,
 * `not_bucketed`, or any unrecognized value) leave the switchboard value alone.
 */
export const INITIAL_AGENT_COHORT_TO_PROFILE: Readonly<Record<string, string>> = {
  initial_agent_v1: 'initial-agent-v1',
  initial_agent_v3: 'initial-agent-v3',
  prompt_enhancer: 'prompt-enhancer',
}

/** Hivemind cohort id for hero copy, value props, examples intro, and section order (matches `hero_content_improvement/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_HERO_CONTENT_COHORT = 'hero_content_improvement' as const

/** Hivemind cohort id for the light homepage engagement arm (matches `light_homepage/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_LIGHT_COHORT = 'light_homepage' as const

/** Hivemind cohort id for the abstract animation homepage arm (matches `abstract_animation/` + `data-homepage-variation`). */
export const HOMEPAGE_ENGAGEMENT_ABSTRACT_ANIMATION_COHORT = 'abstract_animation' as const

export const INELIGIBLE_COHORT = 'ineligible' as const

/** Binary experiment cohorts for simple on/off Hivemind experiments. */
export const COHORT_ON = 'on' as const
export const COHORT_OFF = 'off' as const
