/**
 * i18n keys the AAB host passes into secrets-form components (see app `secretsComposerLabels.ts`).
 * Tests and Storybook use these literals — never hardcoded English like "Save".
 */
export const SECRETS_FORM_HOST_I18N = {
  back: 'builder_common_back',
  cancel: 'builder_common_cancel',
  close: 'builder_common_close',
  continue: 'builder_common_next',
  forward: 'builder_common_next',
  save: 'builder_common_save',
  submit: 'builder_common_submit',
} as const;
