/**
 * Default English copy for Display Ads settings keys (dev fallback until published in @airo-app-builder/aab).
 */
export const DISPLAY_ADS_DEFAULT_MESSAGES = {
  builder_settings_display_ads_save_field_errors: "Couldn't save. Check the highlighted fields.",
  builder_settings_display_ads_saved: 'Saved!',
} satisfies Record<string, string>

export type DisplayAdsKey = keyof typeof DISPLAY_ADS_DEFAULT_MESSAGES

export function defaultMessageForDisplayAdsKey(key: DisplayAdsKey): string {
  return DISPLAY_ADS_DEFAULT_MESSAGES[key]
}
