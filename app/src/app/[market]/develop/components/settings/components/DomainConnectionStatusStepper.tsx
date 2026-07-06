import { type ReactNode, useEffect, useRef } from 'react';
import Box, { box } from '@ux/box';
import Button from '@ux/button';
import CheckmarkIcon from '@ux/icon/checkmark';
import XIcon from '@ux/icon/x';
import Spinner from '@ux/spinner';
import Tag from '@ux/tag';
import text from '@ux/text';

import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton';
import type { ParsedJobStep } from '@/hooks/useDomainJobPolling';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { useSiteStore } from '@/stores/useSiteStore';
import { translateDomainApiError } from '@/utils/domain-validation';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

// Step label ids (returned by the domain job API) that have a matching `${label}_description`
// copy key in the i18n project. Structural gate only — used to decide which steps render a
// subtitle; the copy itself lives in i18n, not here.
const DOMAIN_JOB_STEP_LABELS_WITH_DESCRIPTION: ReadonlySet<string> = new Set([
  'builder_domain_job_starting_connection',
  'builder_domain_job_configuring_dns',
  'builder_domain_job_verifying_domain',
  'builder_domain_job_waiting_for_dns',
  'builder_domain_job_connecting_domain',
  'builder_domain_job_checking_propagation',
  'builder_domain_job_connected',
]);

// Fallback copy for step labels whose i18n key hasn't been set yet.
// Values here are also the canonical reference for what to enter in the i18n project.
const STEP_LABEL_DEFAULTS: Readonly<Record<string, string>> = {
  'builder_domain_job_checking_propagation': 'Waiting for DNS to propagate',
  'builder_domain_job_connected': 'Your domain is connected',
};

// Fallback copy for step description keys. Shown below the step title for steps in
// DOMAIN_JOB_STEP_LABELS_WITH_DESCRIPTION when the i18n key has no value yet.
const STEP_DESCRIPTION_DEFAULTS: Readonly<Record<string, string>> = {
  'builder_domain_job_checking_propagation_description':
    'DNS changes can take up to 48 hours to propagate worldwide. If your site isn\'t loading yet, open it in an incognito (private) window to bypass your browser\'s cache.',
  'builder_domain_job_connected_description':
    'Your domain is live. If you don\'t see the change immediately, try opening your site in a new incognito window — your browser may still be showing a cached version.',
};

interface DomainConnectionStatusStepperProps {
  fqdn: string;
  siteId: string;
  steps: ParsedJobStep[];
  overallStatus: string | null;
  appDomainStatus: string | undefined;
  domainError: AiroDomainErrorResponse | null;
  onRefresh: () => void;
  onDisconnect: () => void;
  isRefreshing: boolean;
}

function StepStatusIcon({ status }: { status: string | null }) {
  const t = useTranslations();
  const ariaLabel: string =
    status === 'SUCCESS' ? t('builder_common_done', undefined, 'Done') :
    status === 'RUNNING' ? t('builder_domain_status_view_step_aria_in_progress') :
    status === 'FAILED' ? t('builder_status_failed', undefined, 'Failed') :
    t('builder_status_pending', undefined, 'Pending');
  if (status === 'SUCCESS') {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-intents-ux-feedbackSuccess-feedbackColor text-intents-ux-feedbackSuccess-onFeedbackColor transition-colors duration-200 motion-reduce:transition-none"
      >
        <CheckmarkIcon className="size-3" />
      </span>
    );
  }
  if (status === 'RUNNING') {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        className="flex size-5 shrink-0 items-center justify-center"
      >
        <Spinner size="sm" />
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-intents-ux-feedbackCritical-feedbackColor text-intents-ux-feedbackCritical-onFeedbackColor transition-colors duration-200 motion-reduce:transition-none"
      >
        <XIcon className="size-3" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-intents-ux-boxLowContrast-borderColor transition-colors duration-200 motion-reduce:transition-none"
    />
  );
}

export default function DomainConnectionStatusStepper({
  fqdn,
  siteId,
  steps,
  overallStatus,
  appDomainStatus,
  domainError,
  onRefresh,
  onDisconnect,
  isRefreshing,
}: DomainConnectionStatusStepperProps) {
  const t = useTranslations();
  const { config } = useGasketConfig();
  const impressionFiredRef = useRef<boolean>(false);
  const errorImpressionFiredRef = useRef<string | null>(null);

  const site = useSiteStore((state) => state.getSite(siteId));
  const publishedUrl: string | null = site?.published_url ?? null;

  const isSuccess: boolean =
    overallStatus === 'SUCCESS' || appDomainStatus === 'active';
  const isError: boolean =
    overallStatus === 'FAILED' ||
    appDomainStatus === 'failed' ||
    appDomainStatus === 'error';

  const domainErrorMessage: string | null = domainError?.error?.code
    ? translateDomainApiError(domainError.error.code, t, domainError.error.message)
    : (domainError?.error?.message ?? null);
  const errorAction: string | null = domainError?.error?.action ?? null;
  const errorCode: string | null = domainError?.error?.code ?? null;

  // True on any fetch while no steps have arrived yet (isRefreshing = isFetching, not just first load)
  const isInitialLoad: boolean = isRefreshing && steps.length === 0;

  useEffect(() => {
    if (impressionFiredRef.current) return;
    impressionFiredRef.current = true;
    logImpressionEvent('settings.domains.status_view_shown')();

    const stepReached: number = steps.reduce((max: number, step: ParsedJobStep, index: number) => {
      if (step.status != null && step.status !== '') return index;
      return max;
    }, 0);
    shipAnalyticsLog('domain.connection_status.viewed', { fqdn, stepReached });
  }, []);

  useEffect(() => {
    if (!isError || !domainErrorMessage) return;
    const key: string = `${errorCode ?? 'unknown'}:${errorAction ?? ''}`;
    if (errorImpressionFiredRef.current === key) return;
    errorImpressionFiredRef.current = key;
    logImpressionEvent('settings.domains.status_view_error_shown', {
      errorCode: errorCode ?? 'unknown',
      action: errorAction ?? '',
    })();
  }, [isError, domainErrorMessage, errorCode, errorAction]);

  const liveAppUrl: string = publishedUrl ?? `https://${fqdn}`;

  // On error, the first step that hasn't succeeded is the one that failed (the API leaves it
  // RUNNING/pending); mark it FAILED so it shows the red ✕ instead of a spinner. -1 when not errored.
  const failedStepIndex: number = isError
    ? steps.findIndex((s: ParsedJobStep) => s.status !== 'SUCCESS')
    : -1;

  // Tinted callout matching the design: light critical fill + subtle critical border + red title.
  // Uses the feedbackCritical accent at low opacity (no dedicated light-surface intent token exists).
  const errorPanel: ReactNode = (
    <Box
      role="alert"
      orientation="vertical"
      gap="sm"
      className="rounded border border-intents-ux-feedbackCritical-feedbackColor/30 bg-intents-ux-feedbackCritical-feedbackColor/10 p-3"
    >
      <text.p size={-1} className="font-medium text-intents-ux-feedbackHighContrastCritical-feedbackColor">
        {t('builder_domain_status_view_error_action_inline', { fqdn })}
      </text.p>
      <text.p size={-1}>{domainErrorMessage}</text.p>
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        {errorAction === 'RETRY' && (
          <Button
            design="primary"
            size="sm"
            text={t('builder_domain_caa_retry', undefined, 'Retry connection')}
            onClick={() => {
              logClickEvent('settings.domains.status_view_retry')();
              onRefresh();
            }}
          />
        )}
        {errorAction !== 'RETRY' && errorAction !== 'CONTACT_SUPPORT' && (
          <Button
            design="secondary"
            size="sm"
            text={t('builder_domain_button_disconnect', undefined, 'Disconnect and reconnect')}
            onClick={() => {
              logClickEvent('settings.domains.status_view_disconnect')();
              onDisconnect();
            }}
          />
        )}
        <Button
          design="inline"
          size="sm"
          as="external"
          href={config?.supportUrl}
          external
          text={t('builder_common_contact_support', undefined, 'Contact support')}
        />
      </Box>
    </Box>
  );

  return (
    <Box orientation="vertical" gap="sm" className="mt-3 border-t border-intents-ux-boxLowContrast-borderColor pt-3">
      {isInitialLoad && (
        <box.ol orientation="vertical" aria-busy="true">
          {Array.from({ length: 3 }, (_: unknown, i: number) => {
            const isLast: boolean = i === 2;
            return (
              <box.li key={i} orientation="horizontal" gap="sm">
                <Box orientation="vertical" inlineAlignChildren="center" gap="sm">
                  <StaticSkeleton width="20px" height="20px" rounding="full" className="shrink-0" />
                  {!isLast && (
                    <div aria-hidden="true" className="w-px flex-1 bg-intents-ux-boxLowContrast-borderColor" />
                  )}
                </Box>
                <Box orientation="vertical" gap="sm" className={`flex-1${isLast ? '' : ' pb-3'}`}>
                  <StaticSkeleton width="150px" height="16px" />
                  <StaticSkeleton width="210px" height="12px" />
                </Box>
              </box.li>
            );
          })}
        </box.ol>
      )}

      {!isInitialLoad && steps.length > 0 && (
        <box.ol orientation="vertical">
          {steps.map((step: ParsedJobStep, index: number) => {
            const isLast: boolean = index === steps.length - 1;
            const isFailed: boolean = step.status === 'FAILED' || index === failedStepIndex;
            const effectiveStatus: string | null = isSuccess
              ? 'SUCCESS'
              : isFailed
                ? 'FAILED'
                : step.status;
            const isRunningStep: boolean = step.status === 'RUNNING' && !isSuccess && !isFailed;
            const showDone: boolean = isSuccess || step.status === 'SUCCESS';
            const stepLabel: string = t(step.label, undefined, STEP_LABEL_DEFAULTS[step.label]);
            const descriptionKey: string = `${step.label}_description`;
            const stepDescription: string | null = DOMAIN_JOB_STEP_LABELS_WITH_DESCRIPTION.has(step.label)
              ? t(descriptionKey, undefined, STEP_DESCRIPTION_DEFAULTS[descriptionKey])
              : null;
            return (
              <box.li
                key={`step-${index}`}
                aria-current={isRunningStep ? ('step' as const) : undefined}
                orientation="horizontal"
                gap="sm"
              >
                <Box orientation="vertical" inlineAlignChildren="center" gap="sm">
                  <StepStatusIcon status={effectiveStatus} />
                  {!isLast && (
                    <div
                      aria-hidden="true"
                      className={`w-px flex-1 transition-colors duration-200 motion-reduce:transition-none ${showDone ? 'bg-intents-ux-feedbackSuccess-feedbackColor' : 'bg-intents-ux-boxLowContrast-borderColor'}`}
                    />
                  )}
                </Box>
                <Box orientation="vertical" gap="sm" className={`flex-1${isLast ? '' : ' pb-3'}`}>
                  <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
                    <text.p
                      size={-1}
                      className={`${isFailed ? 'text-intents-ux-feedbackHighContrastCritical-feedbackColor ' : ''}${isRunningStep ? 'font-semibold' : 'font-medium'}`}
                    >
                      {stepLabel}
                    </text.p>
                    {showDone && (
                      <Tag emphasis="success" size="sm">
                        {t('builder_common_done', undefined, 'Done')}
                      </Tag>
                    )}
                  </Box>
                  {stepDescription && (
                    <text.p size={-2} className="text-intents-ux-boxLowContrast-foregroundColor">
                      {stepDescription}
                    </text.p>
                  )}
                  {isFailed && isError && domainErrorMessage && errorPanel}
                </Box>
              </box.li>
            );
          })}
        </box.ol>
      )}

      {isError && domainErrorMessage && failedStepIndex === -1 && errorPanel}

      {isSuccess && (
        <Box
          role="status"
          orientation="vertical"
          gap="sm"
          className="rounded border border-intents-ux-feedbackSuccess-feedbackColor/30 bg-intents-ux-feedbackSuccess-feedbackColor/10 p-3"
        >
          <text.p size={-1} className="font-medium text-intents-ux-feedbackHighContrastSuccess-feedbackColor">
            {t('builder_domain_status_view_success_headline', { fqdn })}
          </text.p>
          <text.p size={-1}>
            {t('builder_domain_status_view_success_body')}
          </text.p>
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
            <Button
              design="primary"
              size="sm"
              as="external"
              href={liveAppUrl}
              external
              text={t('builder_domain_status_view_live_app')}
              onClick={logClickEvent('settings.domains.view_live_app')}
            />
            <Button
              design="inline"
              size="sm"
              text={t('builder_domain_status_view_manage_domains')}
              onClick={logClickEvent('settings.domains.manage_connected_domains')}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
