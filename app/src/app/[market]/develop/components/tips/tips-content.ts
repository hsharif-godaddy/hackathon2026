/**
 * Tips content for the app creation screen.
 * These tips educate users about App Builder features while they wait for their preview to load.
 */

/**
 * Collection of tips about App Builder features and best practices.
 * Tips are randomized on display to provide variety for returning users.
 * Translations for title and description are in the i18n tool
 */
export const tips: string[] = [
  'be_specific',
  'iterate_and_refine',
  'start_big_picture',
  'show_examples',
  'credits_ai_actions_only',
  'credits_purchased_twelve_months',
  'credits_plan_monthly_reset',
  'credits_varies_by_task',
  'credits_check_balance',
]

/**
 * Tip description i18n keys for the chat thinking-state tips.
 * NOTE: These keys are resolved dynamically via t(selectedKey) in ThinkingTip.tsx,
 * so the i18n key validator cannot detect them statically. All keys must be
 * manually confirmed in the i18n catalog before rollout.
 */
export const thinkingTipsContent: string[] = [
  'builder_tips_select_edit_description',
  'builder_tips_logo_description',
  'builder_tips_continue_description',
  'builder_tips_upload_media_description',
  'builder_tips_media_tab_description',
  'builder_tips_history_description',
  'builder_tips_autosave_description',
  'builder_tips_backup_description',
  'builder_tips_firewall_description',
  'builder_tips_hosting_description',
  'builder_tips_preview_link_description',
  'builder_tips_publish_first_description',
  'builder_tips_republish_description',
  'builder_tips_seo_description',
  'builder_tips_domain_description',
  'builder_tips_pre_publish_description',
  'builder_tips_support_description'
]

/**
 * Shuffles an array using the Fisher-Yates algorithm.
 * Used to randomize tip order on each app creation.
 *
 * @param array - The array to shuffle
 * @returns A new shuffled array
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
