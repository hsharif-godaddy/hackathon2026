/**
 * Cohort IDs for the building-tips-variant Hivemind experiment.
 *
 * Each variant is a complete package: one headline (H1) i18n key set
 * paired with one set of rotating tip card IDs. Variants are compared
 * as whole experiences rather than separate factors.
 */
export const BUILDING_TIPS_VARIANT_COHORT_IDS = {
  /** Variant A — "Building your App..." (control). */
  VARIANT_A: 'variant_a',
  /** Variant B — "Building your project... give me a minute". */
  VARIANT_B: 'variant_b',
  /** Variant C — "Working on your project -- almost there!". */
  VARIANT_C: 'variant_c',
  /** Variant D — "Building your site... loading images... writing copy". */
  VARIANT_D: 'variant_d',
  /** Variant E — "Nothing to do yet, just sit back and relax". */
  VARIANT_E: 'variant_e',
} as const
