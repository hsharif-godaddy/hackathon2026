'use client';

import { useState } from 'react';
import type { AdSenseSettings, AdSenseValidationErrors } from '@airo/shared/adsense';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState';
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { getAdSenseSettingsErrorFields, useAdSenseSettings } from '@/hooks/useAdSenseSettings';
import { useTranslations } from '@/hooks/useTranslations';
import { useAdSenseSettingsForm } from './useAdSenseSettingsForm';

const ADSENSE_GET_STARTED_URL = 'https://adsense.google.com/start/';

interface DisplayAdsPanelProps {
  appId: string;
}

interface TextFileSectionProps {
  field: 'adsTxt' | 'appAdsTxt';
  title: string;
  description: string;
  toggleLabel: string;
  contentLabel: string;
  enabled: boolean;
  disabled: boolean;
  content: string;
  error?: string;
  onEnabledChange: (enabled: boolean) => void;
  onContentChange: (content: string) => void;
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) {
    return null;
  }

  return (
    <text.p id={id} as="caption" emphasis="critical">
      {children}
    </text.p>
  );
}

function textAreaClassName(hasError: boolean) {
  return [
    'w-full min-h-24 rounded-md border p-3 text-sm leading-5',
    'bg-intents-ux-box-backgroundColor',
    'disabled:cursor-not-allowed disabled:opacity-60',
    hasError ? 'border-intents-ux-feedbackHighContrastCritical-borderColor' : 'border-intents-ux-boxLowContrast-borderColor',
  ].join(' ');
}

function TextFileSection({
  field,
  title,
  description,
  toggleLabel,
  contentLabel,
  enabled,
  disabled,
  content,
  error,
  onEnabledChange,
  onContentChange,
}: TextFileSectionProps) {
  const checkboxId = `display-ads-${field}-enabled`;
  const textareaId = `display-ads-${field}-content`;
  const errorId = `display-ads-${field}-error`;

  return (
    <SettingsSection title={title} description={description} hideStatus>
      <Box gap="sm">
        <Checkbox
          id={checkboxId}
          name={checkboxId}
          checked={enabled}
          onChange={onEnabledChange}
          label={toggleLabel}
          disabled={disabled}
        />
        <Box gap="sm">
          <label htmlFor={textareaId} className="text-sm font-medium">
            {contentLabel}
          </label>
          <textarea
            id={textareaId}
            aria-label={contentLabel}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={textAreaClassName(Boolean(error))}
            disabled={disabled || !enabled}
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
          />
          <FieldError id={errorId}>{error}</FieldError>
        </Box>
      </Box>
    </SettingsSection>
  );
}

function getSaveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function hasFieldErrors(fields: AdSenseValidationErrors | undefined): fields is AdSenseValidationErrors {
  return Boolean(fields && Object.keys(fields).length > 0);
}

export function DisplayAdsPanel({ appId }: DisplayAdsPanelProps) {
  const t = useTranslations();
  const { settings, isLoading, error, refetch, saveSettings, isSaving } = useAdSenseSettings(appId);
  const form = useAdSenseSettingsForm(settings);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isAdSenseEnabled = form.values.enabled;

  const handleSave = async () => {
    setSaveMessage(null);
    form.setServerErrors({});

    try {
      const saved = await saveSettings(form.toInput()) as AdSenseSettings;
      form.reset(saved);
      setSaveMessage({
        type: 'success',
        text: t('builder_settings_display_ads_save_success', undefined, 'Display Ads settings saved'),
      });
    } catch (saveError) {
      const fields = getAdSenseSettingsErrorFields(saveError);
      if (hasFieldErrors(fields)) {
        form.setServerErrors(fields);
        return;
      }

      setSaveMessage({
        type: 'error',
        text: getSaveErrorMessage(
          saveError,
          t('builder_settings_display_ads_save_error', undefined, 'Unable to save Display Ads settings'),
        ),
      });
    }
  };

  if (isLoading) {
    return (
      <SettingsLoadingState
        title={t('builder_settings_display_ads_loading', undefined, 'Loading Display Ads settings')}
        fullPage
      />
    );
  }

  if (error) {
    return (
      <Box gap="lg" className="@container">
        <Alert emphasis="critical">
          {t('builder_settings_display_ads_load_error_title', undefined, 'Unable to load Display Ads settings')}
        </Alert>
        <Button
          design="secondary"
          size="sm"
          text={t('builder_common_retry', undefined, 'Retry')}
          onClick={() => refetch()}
        />
      </Box>
    );
  }

  return (
    <Box gap="lg" className="@container">
      {saveMessage && (
        <Alert
          emphasis={saveMessage.type === 'success' ? 'success' : 'critical'}
          onClose={() => setSaveMessage(null)}
        >
          {saveMessage.text}
        </Alert>
      )}

      <SettingsSection
        title={t('builder_settings_display_ads_title', undefined, 'Google AdSense')}
        description={t(
          'builder_settings_display_ads_description',
          undefined,
          'Save your Google AdSense details for the published version of this app.',
        )}
        hideStatus
      >
        <Box gap="md">
          <Checkbox
            id="display-ads-enabled"
            name="display-ads-enabled"
            checked={isAdSenseEnabled}
            onChange={(enabled) => form.updateEnabled(enabled)}
            label={t('builder_settings_display_ads_title', undefined, 'Google AdSense')}
            invalid={Boolean(form.fieldErrors.enabled)}
            errorMessage={form.fieldErrors.enabled}
          />
          <Box gap="sm">
            <label htmlFor="display-ads-script-snippet" className="text-sm font-medium">
              {t('builder_settings_display_ads_script_label', undefined, 'AdSense script snippet')}
            </label>
            <textarea
              id="display-ads-script-snippet"
              aria-label={t('builder_settings_display_ads_script_label', undefined, 'AdSense script snippet')}
              aria-invalid={Boolean(form.fieldErrors.scriptSnippet)}
              aria-describedby={form.fieldErrors.scriptSnippet ? 'display-ads-script-error' : undefined}
              className={`${textAreaClassName(Boolean(form.fieldErrors.scriptSnippet))} font-mono`}
              disabled={!isAdSenseEnabled}
              value={form.values.scriptSnippet}
              onChange={(event) => form.updateScriptSnippet(event.target.value)}
            />
            <text.p as="caption" emphasis="passive">
              {t(
                'builder_settings_display_ads_script_helper',
                undefined,
                'Paste the AdSense script tag from Google. The saved site uses the canonical Google loader on publish.',
              )}
            </text.p>
            {!form.values.scriptSnippet.trim() && (
              <text.p as="caption" emphasis="passive">
                {t(
                  'builder_settings_display_ads_adsense_setup_prompt',
                  undefined,
                  'Need an AdSense account?',
                )}{' '}
                <Button
                  className="ux-text ux-text-caption ux-text-link"
                  design="inline"
                  href={ADSENSE_GET_STARTED_URL}
                  external
                  text={t(
                    'builder_settings_display_ads_adsense_setup_link',
                    undefined,
                    'Get started with Google AdSense',
                  )}
                />
              </text.p>
            )}
            <FieldError id="display-ads-script-error">{form.fieldErrors.scriptSnippet}</FieldError>
          </Box>
        </Box>
      </SettingsSection>

      <TextFileSection
        field="adsTxt"
        title='ads.txt'
        description={t(
          'builder_settings_display_ads_ads_txt_description',
          undefined,
          'Host ads.txt content for Google verification on the published site.',
        )}
        toggleLabel={t('builder_settings_display_ads_ads_txt_toggle', undefined, 'Enable ads.txt')}
        contentLabel={t('builder_settings_display_ads_ads_txt_label', undefined, 'ads.txt content')}
        enabled={form.values.adsTxt.enabled}
        disabled={!isAdSenseEnabled}
        content={form.values.adsTxt.content}
        error={form.fieldErrors.adsTxt}
        onEnabledChange={(enabled) => form.updateTextFileEnabled('adsTxt', enabled)}
        onContentChange={(content) => form.updateTextFileContent('adsTxt', content)}
      />

      <TextFileSection
        field="appAdsTxt"
        title='app-ads.txt'
        description={t(
          'builder_settings_display_ads_app_ads_txt_description',
          undefined,
          'Host app-ads.txt content for app inventory verification on the published site.',
        )}
        toggleLabel={t('builder_settings_display_ads_app_ads_txt_toggle', undefined, 'Enable app-ads.txt')}
        contentLabel={t('builder_settings_display_ads_app_ads_txt_label', undefined, 'app-ads.txt content')}
        enabled={form.values.appAdsTxt.enabled}
        disabled={!isAdSenseEnabled}
        content={form.values.appAdsTxt.content}
        error={form.fieldErrors.appAdsTxt}
        onEnabledChange={(enabled) => form.updateTextFileEnabled('appAdsTxt', enabled)}
        onContentChange={(content) => form.updateTextFileContent('appAdsTxt', content)}
      />

      <Box gap="sm" inlineAlignChildren="end">
        <text.p as="caption" emphasis="passive">
          {t('builder_settings_display_ads_next_publish', undefined, 'Changes apply on your next publish')}
        </text.p>
        <Button
          design="primary"
          size="sm"
          text={isSaving
            ? t('builder_settings_display_ads_saving', undefined, 'Saving...')
            : t('builder_common_save', undefined, 'Save')
          }
          icon={isSaving ? <Spinner size="sm" /> : undefined}
          disabled={!form.isDirty || isSaving || !appId}
          onClick={handleSave}
        />
      </Box>
    </Box>
  );
}

export default DisplayAdsPanel;
