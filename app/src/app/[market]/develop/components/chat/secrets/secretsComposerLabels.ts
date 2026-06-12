import type { useTranslations } from '@/hooks/useTranslations'

type Translate = ReturnType<typeof useTranslations>

/** i18n keys passed to pattern-library secrets forms — keep in sync with `secretsFormHostLabels.ts`. */
export const SECRETS_COMPOSER_SAVE_I18N_KEY = 'builder_common_save'
export const SECRETS_COMPOSER_SUBMIT_I18N_KEY = 'builder_common_submit'
export const SECRETS_COMPOSER_CONTINUE_I18N_KEY = 'builder_common_next'

export function secretsComposerSaveLabel(t: Translate): string {
  return t(SECRETS_COMPOSER_SAVE_I18N_KEY)
}

export function secretsComposerSendLabel(t: Translate): string {
  return t(SECRETS_COMPOSER_SUBMIT_I18N_KEY)
}

export function secretsComposerContinueLabel(t: Translate): string {
  return t(SECRETS_COMPOSER_CONTINUE_I18N_KEY)
}
