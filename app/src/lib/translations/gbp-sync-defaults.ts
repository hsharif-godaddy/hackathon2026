/**
 * Default English copy for the Google Business Profile sync tool renderer keys
 * (dev fallback until published in @airo-app-builder/aab). Registered in
 * scripts/validate-i18n.mjs so these keys pass the pre-commit key check before
 * they exist in the i18n portal; react-intl renders the defaultMessage meanwhile.
 */
export const GBP_SYNC_DEFAULT_MESSAGES = {
  builder_gbp_sync_reading_title: 'Reading Google Business Profile',
  builder_gbp_sync_updating_title: 'Updating Google Business Profile',
  builder_gbp_sync_reading_progress: 'Reading your Google Business Profile listing…',
  builder_gbp_sync_updating_progress: 'Updating your Google Business Profile…',
  builder_gbp_sync_reading_done: 'Listing loaded.',
  builder_gbp_sync_updating_done: 'Listing updated.',
  builder_gbp_sync_error_generic: 'Something went wrong.',
} satisfies Record<string, string>

export type GbpSyncKey = keyof typeof GBP_SYNC_DEFAULT_MESSAGES

export function defaultMessageForGbpSyncKey(key: GbpSyncKey): string {
  return GBP_SYNC_DEFAULT_MESSAGES[key]
}
