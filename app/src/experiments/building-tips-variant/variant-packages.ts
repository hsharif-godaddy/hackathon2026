import { tips } from '@/app/[market]/develop/components/tips/tips-content'
import { INELIGIBLE_COHORT } from '@/config/experiments'
import { BUILDING_TIPS_VARIANT_COHORT_IDS } from '@/experiments/building-tips-variant/cohort-ids'

/** Default English copy for one tip card, shown until its i18n keys are live. */
export interface TipCardDefault {
  title: string
  description: string
}

/**
 * A complete loading-screen experience package.
 *
 * Bundles the headline i18n keys shown during the initial build with the
 * rotating tip card IDs so both are varied together as one unit. Each
 * i18n key name follows the `builder_` prefix convention and must exist
 * in the translation tool before the experiment goes live.
 *
 * Tip card copy is resolved at render time as:
 *   `builder_tips_{tipId}_title`
 *   `builder_tips_{tipId}_description`
 */
export interface TipsVariantPackage {
  /** Tip card IDs rendered as the rotating stack beneath the headline. */
  tipIds: string[]
  /**
   * Default English copy keyed by tip ID. Lets a new card set render real
   * text before its `builder_tips_{id}_title/_description` keys exist in the
   * translation tool. Tip IDs absent here resolve via i18n only (e.g. the
   * control set, whose keys are already published).
   */
  tipCopyDefaults: Record<string, TipCardDefault>
  /** i18n key for the "building your app" headline (agent is actively building). */
  buildingAppMessageKey: string
  /** Fallback English copy for buildingAppMessageKey — shown when the i18n key is not yet in the translation tool. */
  buildingAppDefaultMessage: string
  /** i18n key for the "loading your app" headline (server polling, not yet building). */
  loadingAppMessageKey: string
  /** Fallback English copy for loadingAppMessageKey — shown when the i18n key is not yet in the translation tool. */
  loadingAppDefaultMessage: string
}

/**
 * Shared treatment card set. Every treatment variant (B–E) renders this same
 * package of four cards; only the headline differs between variants. Mirrors
 * the single "Package of card copy" in the experiment design.
 */
const TREATMENT_TIP_IDS = [
  'start_big_picture_v2',
  'get_into_details',
  'show_examples_v2',
  'ask_one_change',
]

const TREATMENT_TIP_COPY: Record<string, TipCardDefault> = {
  start_big_picture_v2: {
    title: 'Start with the big picture',
    description: 'I’ll build the first version of your project based on what you’ve already told me.',
  },
  get_into_details: {
    title: 'Get into the details',
    description: 'You can make tweaks to refine your idea once the first draft is complete.',
  },
  show_examples_v2: {
    title: 'Show visual examples',
    description: 'After your draft is complete, upload an image or file so Airo can match your vision.',
  },
  ask_one_change: {
    title: 'Ask for one change at a time',
    description: 'Focus on one change at a time to guide your draft to a strong finished product.',
  },
}

/**
 * Variant A (control) — "Building your App..."
 * Uses the existing production keys and tip cards.
 */
const VARIANT_A_PACKAGE: TipsVariantPackage = {
  tipIds: tips,
  tipCopyDefaults: {},
  buildingAppMessageKey: 'builder_preview_building_app',
  buildingAppDefaultMessage: 'Building your App',
  loadingAppMessageKey: 'builder_preview_loading_app',
  loadingAppDefaultMessage: 'Loading your App',
}

/**
 * Builds a treatment variant package (B–E) from a single source of truth.
 *
 * Treatments share the same tip cards and copy, differing only by cohort
 * `suffix` and headline `message`. Their building and loading headlines are
 * intentionally identical, so both i18n key + default-message pairs are derived
 * from the one `suffix`/`message` here — there is no second copy to drift out
 * of sync. The matching `builder_preview_building_app_{suffix}` key must exist
 * in the translation tool before a variant is enabled:
 *   https://i18n.int.gdcorp.tools/org/hcx/app/aab
 */
function makeTreatmentPackage(suffix: string, message: string): TipsVariantPackage {
  const messageKey = `builder_preview_building_app_${suffix}`
  return {
    tipIds: TREATMENT_TIP_IDS,
    tipCopyDefaults: TREATMENT_TIP_COPY,
    buildingAppMessageKey: messageKey,
    buildingAppDefaultMessage: message,
    loadingAppMessageKey: messageKey,
    loadingAppDefaultMessage: message,
  }
}

/**
 * Union of every cohort ID in the experiment. Using this (instead of `string`)
 * as the PACKAGES key type makes the map exhaustive: adding a cohort to
 * cohort-ids.ts without wiring a package here becomes a compile error rather
 * than a silent fall-through to control.
 */
type CohortId = (typeof BUILDING_TIPS_VARIANT_COHORT_IDS)[keyof typeof BUILDING_TIPS_VARIANT_COHORT_IDS]

const PACKAGES: Readonly<Record<CohortId | typeof INELIGIBLE_COHORT, TipsVariantPackage>> = {
  [BUILDING_TIPS_VARIANT_COHORT_IDS.VARIANT_A]: VARIANT_A_PACKAGE,
  [INELIGIBLE_COHORT]: VARIANT_A_PACKAGE,
  [BUILDING_TIPS_VARIANT_COHORT_IDS.VARIANT_B]: makeTreatmentPackage('b', 'Building your project... give me a minute'),
  [BUILDING_TIPS_VARIANT_COHORT_IDS.VARIANT_C]: makeTreatmentPackage('c', 'Working on your project — almost there!'),
  [BUILDING_TIPS_VARIANT_COHORT_IDS.VARIANT_D]: makeTreatmentPackage('d', 'Building your site... loading images... writing copy'),
  [BUILDING_TIPS_VARIANT_COHORT_IDS.VARIANT_E]: makeTreatmentPackage('e', 'Nothing to do yet, just sit back and relax'),
}

/**
 * Returns the variant package for a given Hivemind cohort ID.
 * Falls back to Variant A (control) for unassigned or unrecognised cohorts.
 */
export function packageForCohort(cohort: string | undefined): TipsVariantPackage {
  return PACKAGES[cohort as CohortId] ?? VARIANT_A_PACKAGE
}
