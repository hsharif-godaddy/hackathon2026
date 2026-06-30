/**
 * Hivemind experiment IDs. Single source of truth for A/B and engagement experiments.
 */
export const EXPERIMENT_IDS = {
  /** Initial agent selection: maps cohort → agent profile. Only one agent-config experiment should run at a time. */
  initialAgent: 'airo-build-initial-agent',
  /** BMS A/A: assigns homepage new users to BMS for baseline measurement. Both cohorts receive BMS — A/A only. */
  bmsLaunchAA: 'airo-app-builder-bms-launch-aa',
  /** Building tips variant: tests the initial build loading screen (H1 headline + tip cards) as a single packaged experience. */
  buildingTipsVariant: 'endgame_first_build_action_h1_update',
  /** First-build progress tracker: shows the 5-stage stepper during the first build (treatment cohort `on`) vs not (control). Gated in PreviewPane via useAabProgressTracker. */
  aabProgressTracker: 'aab_progress_tracker',
  /** Combine Upgrade + Publish into a single Publish button with an educational upsell popup. */
  combineUpgradeWithPublish: 'aab_combine_upgrade_with_publish',
  /** Default domain selection: pick which custom domain the publish modal targets. */
  defaultDomainSelection: 'aab_default_domain_selection',
  /** Upgrade banner placement: chat panel (off) vs preview bar (on). Free users only. */
  upgradeBannerPlacement: 'aab-upgrade-banner-placement',
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
  initial_agent_design_system: 'initial-agent-design-system',
  initial_agent_design_system_homepage_build: 'initial-agent-design-system-homepage-build',
}

export const INELIGIBLE_COHORT = 'ineligible' as const

/** Binary experiment cohorts for simple on/off Hivemind experiments. */
export const COHORT_ON = 'on' as const
export const COHORT_OFF = 'off' as const

/** Initial-agent experiment cohort for the standard (non-fullscreen) winning v3 agent. */
export const INITIAL_AGENT_V3_COHORT = 'initial_agent_v3' as const
