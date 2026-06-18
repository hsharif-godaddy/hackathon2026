'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useState } from 'react';
import type { AdSenseSettings, AdSenseValidationErrors } from '@airo/shared/adsense';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import CheckmarkIcon from '@ux/icon/checkmark';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import ToggleButton from '@ux/toggle-button';

import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState';
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { getAdSenseSettingsErrorFields, useAdSenseSettings } from '@/hooks/useAdSenseSettings';
import { useTranslations } from '@/hooks/useTranslations';
import { useAdSenseSettingsForm } from './useAdSenseSettingsForm';

const ADSENSE_GET_STARTED_URL = 'https://adsense.google.com/start/';
const SAVE_SAVED_FEEDBACK_LIFETIME_MS = 1500;
const collapseTransition = { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const };

interface CollapseSectionProps {
  show: boolean;
  children: ReactNode;
}

function CollapseSection({ show, children }: CollapseSectionProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : collapseTransition}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DisplayAdsPanelProps {
  appId: string;
}

interface DisplayAdsToggleProps {
  id: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  errorMessage?: string;
  onChange: (active: boolean) => void;
}

interface TextFileSectionProps {
  field: 'adsTxt' | 'appAdsTxt';
  title: string;
  description: string;
  toggleLabel: string;
  contentLabel: string;
  enabled: boolean;
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

function DisplayAdsToggle({
  id,
  label,
  active,
  disabled = false,
  errorMessage,
  onChange,
}: DisplayAdsToggleProps) {
  const errorId = `${id}-error`;

  return (
    <Box gap="sm">
      <div className="flex items-center gap-3">
        <ToggleButton
          id={id}
          active={active}
          disabled={disabled}
          aria-label={label}
          onClick={() => onChange(!active)}
        />
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      </div>
      {errorMessage && (
        <FieldError id={errorId}>{errorMessage}</FieldError>
      )}
    </Box>
  );
}

function TextFileSection({
  field,
  title,
  description,
  toggleLabel,
  contentLabel,
  enabled,
  content,
  error,
  onEnabledChange,
  onContentChange,
}: TextFileSectionProps) {
  const toggleId = `display-ads-${field}-enabled`;
  const textareaId = `display-ads-${field}-content`;
  const errorId = `display-ads-${field}-error`;

  return (
    <Box gap="sm">
      <DisplayAdsToggle
        id={toggleId}
        label={toggleLabel}
        active={enabled}
        errorMessage={error}
        onChange={onEnabledChange}
      />
      <CollapseSection show={enabled}>
        <Box gap="sm" className="pt-1">
          <text.h3 as="title">{title}</text.h3>
          <text.p>{description}</text.p>
          <label htmlFor={textareaId} className="text-sm font-medium">
            {contentLabel}
          </label>
          <textarea
            id={textareaId}
            aria-label={contentLabel}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={textAreaClassName(Boolean(error))}
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
          />
        </Box>
      </CollapseSection>
    </Box>
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

function hasFieldSaveErrors(errors: AdSenseValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

function firstFieldErrorMessage(fields: AdSenseValidationErrors): string | undefined {
  return fields.enabled ?? fields.scriptSnippet ?? fields.adsTxt ?? fields.appAdsTxt;
}

export function DisplayAdsPanel({ appId }: DisplayAdsPanelProps) {
  const t = useTranslations();
  const { settings, isLoading, error, refetch, saveSettings, isSaving } = useAdSenseSettings(appId);
  const form = useAdSenseSettingsForm(settings);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const isAdSenseEnabled = form.values.enabled;
  const fieldSaveErrors = form.fieldErrors;

  useEffect(() => {
    if (!showSavedFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSavedFeedback(false);
    }, SAVE_SAVED_FEEDBACK_LIFETIME_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showSavedFeedback]);

  const handleSave = async () => {
    setShowSavedFeedback(false);
    form.setServerErrors({});

    try {
      const saved = await saveSettings(form.toInput()) as AdSenseSettings;
      form.reset(saved);
      setShowSavedFeedback(true);
    } catch (saveError) {
      const fields = getAdSenseSettingsErrorFields(saveError);
      if (hasFieldErrors(fields)) {
        form.setServerErrors(fields);
        Growl.addGrowlMessage({
          id: 'display-ads-save-field-errors',
          title: t('builder_status_error', undefined, 'Error'),
          children: firstFieldErrorMessage(fields)
            ?? t('builder_settings_display_ads_save_error', undefined, 'Unable to save Display Ads settings'),
          emphasis: 'critical',
          lifetime: 5000,
        });
        return;
      }

      Growl.addGrowlMessage({
        id: 'display-ads-save-error',
        title: t('builder_status_error', undefined, 'Error'),
        children: getSaveErrorMessage(
          saveError,
          t('builder_settings_display_ads_save_error', undefined, 'Unable to save Display Ads settings'),
        ),
        emphasis: 'critical',
        lifetime: 5000,
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
          <DisplayAdsToggle
            id="display-ads-enabled"
            label={t('builder_settings_display_ads_enable_toggle', undefined, 'Enable Google AdSense')}
            active={isAdSenseEnabled}
            errorMessage={form.fieldErrors.enabled}
            onChange={(enabled) => form.updateEnabled(enabled)}
          />
          <CollapseSection show={isAdSenseEnabled}>
            <Box gap="sm" className="pt-1">
              <label htmlFor="display-ads-script-snippet" className="text-sm font-medium">
                {t('builder_settings_display_ads_script_label', undefined, 'AdSense script snippet')}
              </label>
              <textarea
                id="display-ads-script-snippet"
                aria-label={t('builder_settings_display_ads_script_label', undefined, 'AdSense script snippet')}
                aria-invalid={Boolean(form.fieldErrors.scriptSnippet)}
                aria-describedby={form.fieldErrors.scriptSnippet ? 'display-ads-script-error' : undefined}
                className={`${textAreaClassName(Boolean(form.fieldErrors.scriptSnippet))} font-mono`}
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
          </CollapseSection>
        </Box>
      </SettingsSection>

      <CollapseSection show={isAdSenseEnabled}>
        <Box gap="lg">
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
            content={form.values.appAdsTxt.content}
            error={form.fieldErrors.appAdsTxt}
            onEnabledChange={(enabled) => form.updateTextFileEnabled('appAdsTxt', enabled)}
            onContentChange={(content) => form.updateTextFileContent('appAdsTxt', content)}
          />
        </Box>
      </CollapseSection>

      <CollapseSection show={isAdSenseEnabled || form.isDirty || showSavedFeedback || hasFieldSaveErrors(fieldSaveErrors)}>
        <Box gap="sm" className="pt-1">
          {hasFieldSaveErrors(fieldSaveErrors) && (
            <Alert emphasis="critical" onClose={() => form.setServerErrors({})}>
              {t(
                'builder_settings_display_ads_save_field_errors',
                undefined,
                "Couldn't save. Check the highlighted fields.",
              )}
            </Alert>
          )}
          <Box gap="sm" inlineAlignChildren="end">
          <Button
            design="primary"
            size="sm"
            className={showSavedFeedback
              ? '!border-intents-ux-feedbackSuccess-feedbackColor !bg-intents-ux-feedbackSuccess-feedbackColor !text-intents-ux-feedbackSuccess-onFeedbackColor'
              : undefined
            }
            text={showSavedFeedback
              ? t('builder_settings_display_ads_saved', undefined, 'Saved!')
              : t('builder_common_save', undefined, 'Save')
            }
            icon={isSaving
              ? <Spinner size="sm" />
              : showSavedFeedback
                ? <CheckmarkIcon />
                : undefined
            }
            disabled={isSaving || !appId || (!showSavedFeedback && !form.isDirty)}
            onClick={handleSave}
          />
          <text.p as="caption" emphasis="passive">
            {t('builder_settings_display_ads_next_publish', undefined, 'To see changes live, publish now.')}
          </text.p>
          </Box>
        </Box>
      </CollapseSection>
    </Box>
  );
}

export default DisplayAdsPanel;
