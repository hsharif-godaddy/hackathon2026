/**
 * Hivemind experiment IDs. Single source of truth for A/B and engagement experiments.
 */
export const EXPERIMENT_IDS = {
  /** BMS A/A: assigns homepage new users to BMS for baseline measurement. Both cohorts receive BMS — A/A only. */
  bmsLaunchAA: 'airo-app-builder-bms-launch-aa',
  /** Building tips variant: tests the initial build loading screen (H1 headline + tip cards) as a single packaged experience. */
  buildingTipsVariant: 'endgame_first_build_action_h1_update',
  /** First-build progress tracker: shows the 5-stage stepper during the first build (treatment cohort `on`) vs not (control). Gated in PreviewPane via useAabProgressTracker. */
  aabProgressTracker: 'aab_progress_tracker',
  /** Prompt starter buttons: homepage hero category buttons (treatment cohort `on`) vs not (control `off`). Read via usePromptStarter. */
  promptStarter: 'prompt_starter',
  /** Default domain selection: pick which custom domain the publish modal targets. */
  defaultDomainSelection: 'aab_default_domain_selection',
  /** Upgrade banner placement: chat panel (off) vs preview bar (on). Free users only. */
  upgradeBannerPlacement: 'aab-upgrade-banner-placement',
  /** Publish button label: 3-way A/B/C test on button copy to improve publish rate. */
  publishButtonLabel: 'aab_publish_button_label',
  /** Commander UI rollout: cohort 'on' switches real-customer BuilderLayout to Commander. Read client-side in useBuilderLayout. Dev override via appbuilder-commander flag. */
  commanderUI: 'airo-builder-commander-UI',
} as const

export const INELIGIBLE_COHORT = 'ineligible' as const

/** Binary experiment cohorts for simple on/off Hivemind experiments. */
export const COHORT_ON = 'on' as const
export const COHORT_OFF = 'off' as const
