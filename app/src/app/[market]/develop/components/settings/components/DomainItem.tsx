import { useEffect, useRef, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import ChevronDownIcon from '@ux/icon/chevron-down';
import EditIcon from '@ux/icon/edit';
import LinkIcon from '@ux/icon/link';
import MenuIcon from '@ux/icon/menu';
import RefreshIcon from '@ux/icon/refresh';
import UnlinkIcon from '@ux/icon/unlink';
import Radio from "@ux/radio";
import Spinner from "@ux/spinner";
import Tag from "@ux/tag";
import text from "@ux/text";

import { finishDomainJourney, trackDomainConnectStep } from '@/hooks/shared/domainJourneyFunnel';
import type { AppDomain } from '@/hooks/useAppDetails';
import { useCaaRemediation } from '@/hooks/useCaaRemediation';
import { isDomainRecentlyConnected, useDomainConflictCheck } from '@/hooks/useDomainConflictCheck';
import { domainJobQueryKey, useDomainJobPolling } from '@/hooks/useDomainJobPolling';
import type { Domain } from '@/hooks/useDomainsQuery';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { DomainMutationError } from '@/hooks/useModifyDomains';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus } from '@/lib/control-plane/types';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { CdnStatus } from "@/lib/mgmt-airo/types";
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/shadcn/popover"
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { normalizeFqdn } from '@/utils/domain';
import { CAA_REMEDIATION_NOT_GD_MANAGED, caaVariantForCode, translateDomainApiError } from '@/utils/domain-validation';
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { DkimStatusBadge } from './DkimStatusBadge';
import DomainConnectConfirmation from './DomainConnectConfirmation';
import DomainConnectionStatusStepper from './DomainConnectionStatusStepper';

function getDomainUrl(domain: string): string {
  if (!domain) return '';
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  return `https://${domain}`;
}

function getDomainSpecificError(error: Error | null, domainName: string, _t: ReturnType<typeof useTranslations>): string | null {
  if (!error || !domainName) return null;
  if (error instanceof DomainMutationError) {
    return error.details.domainSpecificError?.[domainName.trim().toLowerCase()] ?? null;
  }
  return null;
}

/**
 * Get translated status label based on domain connection status
 */
function getStatusLabel(appDomain: AppDomain | undefined, t: ReturnType<typeof useTranslations>): string {
  if (!appDomain) return t('builder_domain_status_not_connected');
  if (appDomain.status === DomainStatus.ACTIVE) return t('builder_domain_status_active');
  if (appDomain.status === DomainStatus.PENDING || !appDomain.status) return t('builder_domain_status_pending');
  if (appDomain.status === DomainStatus.FAILED || appDomain.status === DomainStatus.ERROR) return t('builder_domain_status_error');
  if (appDomain.status === DomainStatus.DELETING) return t('builder_domain_status_deleting');
  return appDomain.status;
}

function getConnectedDomainTagLabel(
  appDomain: AppDomain | undefined,
  hasInProgressJobFromStore: boolean,
  t: ReturnType<typeof useTranslations>,
): string {
  if (hasInProgressJobFromStore) {
    return t('builder_domain_attach_connecting');
  }
  if (!appDomain) {
    return t('builder_domain_status_not_connected');
  }
  return getStatusLabel(appDomain, t);
}

export default function DomainItem({
  domain,
  appDomain,
  appId,
  siteId,
  onConnect,
  onDisconnect,
  isLoading = false,
  disableConnect = false,
  isCustomDomain = false,
  radioMode = false,
  isSelected = false,
  onSelect,
  mutationError = null,
  isPrePublishConnect = false
}: {
  domain: Domain;
  appDomain?: AppDomain;
  appId?: string;
  siteId: string;
  onConnect: (domainName: string) => void;
  onDisconnect: (domainName: string) => void;
  isLoading?: boolean;
  disableConnect?: boolean;
  isCustomDomain?: boolean;
  radioMode?: boolean;
  isSelected?: boolean;
  onSelect?: (domainName: string) => void;
  mutationError?: Error | null;
  // Pre-publish treatment: connect publishes first, then attaches. Relabels the CTA.
  isPrePublishConnect?: boolean;
}) {
  const t = useTranslations();
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');
  const isCaaRemediationEnabled = useSwitchboard('appbuilder-domain-caa-remediation');
  const isConnectionStatusViewEnabled = useSwitchboard('appbuilder-domain-connection-status-view');
  const queryClient = useQueryClient();
  const { config } = useGasketConfig();
  const caaRemediation = useCaaRemediation();
  const [open, setOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [stepperExpanded, setStepperExpanded] = useState<boolean>(true);
  const [domainError, setDomainError] = useState<AiroDomainErrorResponse | null>(null);
  const errorShownRef = useRef<string | null>(null); // keyed on domainName + errorCode
  const mutationErrorShownRef = useRef<string | null>(null); // keyed on domainName
  const statusShownRef = useRef<string | null>(null); // keyed on domainName + status
  const caaBannerShownRef = useRef<string | null>(null); // keyed on domainName + variant
  const lastConnectStepRef = useRef<string | null>(null); // funnel connect_step dedupe, keyed on labelKey
  const connectTimeoutFiredRef = useRef<boolean>(false); // funnel connect_failed timeout latch
  const domainName = domain.domain || domain.name || '';
  /** True when app details include this domain (any status: PENDING, ACTIVE, …). Not the same as “ACTIVE only”. */
  const isConnected = !!appDomain;
  const { hasDnsDrift } = useDomainConflictCheck(
    appId ?? siteId,
    domainName,
    appDomain?.anycastIp,
    isConnected && appDomain?.status === DomainStatus.ACTIVE && !isDomainRecentlyConnected(appDomain?.createdAt),
  );
  const domainJobForApp = useDevelopPageStore((s) => s.domainJobsInProgress[siteId]);
  const activeJobForDomain =
    domainJobForApp && domainJobForApp.fqdn === domainName.trim().toLowerCase()
      ? domainJobForApp
      : null;
  /** A domain is "connecting" while it has an active job or sits in PENDING/FAILED/ERROR. */
  const isConnectingState: boolean =
    Boolean(activeJobForDomain)
    || appDomain?.status === DomainStatus.PENDING
    || appDomain?.status === DomainStatus.FAILED
    || appDomain?.status === DomainStatus.ERROR;
  const shouldPollJob: boolean =
    Boolean(activeJobForDomain)
    || (isCustomDomain
      && appDomain != null
      && (appDomain.status == null || appDomain.status === DomainStatus.PENDING))
    || (isConnectionStatusViewEnabled === true && isConnectingState);
  /** Render the connection status stepper for any connecting domain when the flag is on. */
  const showConnectionStepper: boolean =
    isConnectionStatusViewEnabled === true && isConnectingState;
  const {
    labelKey: polledLabelKey,
    status: polledStatus,
    overallStatus: polledOverallStatus,
    steps: polledSteps,
    isFetching: isJobFetching,
    error: jobPollError,
  } = useDomainJobPolling(
    siteId,
    domainName,
    shouldPollJob,
    // Milestone 11 (funnel.domain.connect_failed, outcome=timeout): poll exhausted
    // its max duration while the job was still running. Latched so it fires once.
    (elapsedMs: number) => {
      if (connectTimeoutFiredRef.current) return;
      connectTimeoutFiredRef.current = true;
      finishDomainJourney('connect_failed', 'timeout', {
        appId: siteId,
        fqdn: domainName,
        errorType: 'poll_timeout',
        elapsedMs,
      });
    },
  );

  function handleRefreshJobStatus(): void {
    void queryClient.invalidateQueries({ queryKey: domainJobQueryKey(siteId, domainName) });
  }

  const translatedPolledLabel: string | null = polledLabelKey ? t(polledLabelKey) : null;

  const hasActiveJob = Boolean(activeJobForDomain);
  const polledTerminal =
    polledStatus === 'SUCCESS'
    || polledStatus === 'FAILED'
    || polledOverallStatus === 'SUCCESS'
    || polledOverallStatus === 'FAILED'
    || polledOverallStatus === 'NOT_FOUND';
  const showDomainStatusTag =
    isConnected
    || hasActiveJob
    || (shouldPollJob && !!polledLabelKey);

  const connectedTagLabel =
    shouldPollJob &&
    !jobPollError &&
    polledLabelKey &&
    translatedPolledLabel?.trim() &&
    !polledTerminal
      ? translatedPolledLabel.trim()
      : getConnectedDomainTagLabel(appDomain, Boolean(activeJobForDomain), t);

  useEffect(() => {
    if (appDomain?.status !== DomainStatus.ACTIVE) return;
    queryClient.removeQueries({ queryKey: domainJobQueryKey(siteId, domainName) });
  }, [appDomain?.status, queryClient, siteId, domainName]);

  // Milestone 9 (funnel.domain.connect_step): emit each mgmt-airo job sub-step as
  // it changes. Deduped on labelKey so a step isn't re-emitted across polls; the
  // latches re-arm whenever polling stops so a later connect attempt tracks fresh.
  useEffect(() => {
    if (!shouldPollJob) {
      lastConnectStepRef.current = null;
      connectTimeoutFiredRef.current = false;
      return;
    }
    if (jobPollError || !polledLabelKey) return;
    if (lastConnectStepRef.current === polledLabelKey) return;
    lastConnectStepRef.current = polledLabelKey;
    trackDomainConnectStep(polledLabelKey, { appId: siteId, fqdn: domainName });
  }, [shouldPollJob, jobPollError, polledLabelKey, siteId, domainName]);

  // Clear in-progress job when poll reports terminal job status or when app domain reaches a terminal status.
  useEffect(() => {
    function clearJobWhenTerminal() {
      if (jobPollError) {
        logger.error('domain-item.poll.error', {
          siteId,
          fqdn: domainName,
          error: jobPollError.message,
        });
        if (activeJobForDomain) {
          // Milestone 11 (funnel.domain.connect_failed): poll request errored.
          finishDomainJourney('connect_failed', 'failure', {
            appId: siteId,
            fqdn: domainName,
            errorType: 'poll_error',
          });
          useDevelopPageStore.getState().clearDomainJobInProgress(siteId);
        }
        return;
      }
      if (!activeJobForDomain) {
        return;
      }
      if (polledTerminal) {
        const succeeded = polledStatus === 'SUCCESS' || polledOverallStatus === 'SUCCESS';
        if (succeeded) {
          // Milestone 10 (funnel.domain.connect_completed): job reached SUCCESS.
          finishDomainJourney('connect_completed', 'success', { appId: siteId, fqdn: domainName });
        } else {
          // Milestone 11 (funnel.domain.connect_failed): job FAILED / NOT_FOUND.
          finishDomainJourney('connect_failed', 'failure', {
            appId: siteId,
            fqdn: domainName,
            errorType: polledOverallStatus ?? polledStatus ?? 'poll_terminal_failed',
          });
        }
        useDevelopPageStore.getState().clearDomainJobInProgress(siteId);
        return;
      }
      if (!appDomain) return;
      const { status } = appDomain;
      if (status !== DomainStatus.ACTIVE && status !== DomainStatus.FAILED) return;
      if (status === DomainStatus.ACTIVE) {
        // Milestone 10 (funnel.domain.connect_completed): domain reached ACTIVE.
        finishDomainJourney('connect_completed', 'success', { appId: siteId, fqdn: domainName });
      } else {
        // Milestone 11 (funnel.domain.connect_failed): domain reached FAILED.
        finishDomainJourney('connect_failed', 'failure', {
          appId: siteId,
          fqdn: domainName,
          errorType: 'domain_failed',
        });
      }
      useDevelopPageStore.getState().clearDomainJobInProgress(siteId);
    }
    clearJobWhenTerminal();
  }, [siteId, activeJobForDomain, appDomain?.status, polledTerminal, polledStatus, polledOverallStatus, jobPollError, domainName]);

  useEffect(() => {
    const abortController = new AbortController();
    const hasErrorStatus =
      appDomain?.status === DomainStatus.FAILED ||
      appDomain?.status === DomainStatus.ERROR ||
      appDomain?.cdnStatus === CdnStatus.ERROR;

    if (hasErrorStatus && siteId && domainName) {
      const fetchDomainError = async () => {
        try {
          const response = await fetch(
            `/api/sites/${siteId}/domain-errors?fqdn=${encodeURIComponent(domainName)}`,
            { signal: abortController.signal }
          );

          if (response.status === 404) {
            setDomainError(null);
            return;
          }

          if (response.ok) {
            const errorData: AiroDomainErrorResponse = await response.json();
            setDomainError(errorData);
          } else {
            logger.warn('domain-item.fetch-error.unexpected-status', {
              siteId,
              domainName,
              status: response.status
            });
            setDomainError(null);
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
          logger.error('domain-item.fetch-error.failure', {
            message: 'Failed to fetch domain error',
            siteId,
            domainName,
            error: error instanceof Error ? error.message : String(error)
          });
          setDomainError(null);
        }
      };
      fetchDomainError();
    } else {
      setDomainError(null);
    }

    return () => {
      abortController.abort();
    };
  }, [appDomain?.status, appDomain?.cdnStatus, siteId, domainName]);

  const handleConnectClick = () => {
    logClickEvent('settings.domains.item_connect_click')();
    setShowConfirmation(true);
  };

  const handleConfirmConnect = () => {
    logClickEvent('settings.domains.item_connect_confirm')();
    setOpen(false);
    setShowConfirmation(false);
    onConnect(domainName);
  };

  const handleCancelConnect = () => {
    setShowConfirmation(false);
  };

  const handleDisconnect = () => {
    setOpen(false);
    onDisconnect(domainName);
  };

  const handlePopoverOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setShowConfirmation(false);
    }
  };

  const domainSpecificErrorMsg = getDomainSpecificError(mutationError, domainName, t);
  const domainErrorMessage = domainError?.error?.code
    ? translateDomainApiError(domainError.error.code, t, domainError.error.message)
    : domainError?.error?.message;

  // A consent-variant Approve can come back DOMAIN_NOT_GD_MANAGED (the /domain-errors
  // classification and the remediation ownership check disagreed). Fall back to the
  // self-service manual instructions instead of surfacing the raw backend error.
  const remediationNotGdManaged =
    caaRemediation.error instanceof DomainMutationError &&
    (caaRemediation.error.details.code === CAA_REMEDIATION_NOT_GD_MANAGED ||
      caaRemediation.error.details.nestedCode === CAA_REMEDIATION_NOT_GD_MANAGED);

  // Single gating chokepoint: null (flag off or non-CAA code) falls back to the
  // generic error block; the banner and its actions all hang off caaVariant.
  const caaVariant = !isCaaRemediationEnabled
    ? null
    : remediationNotGdManaged
      ? 'selfService'
      : caaVariantForCode(domainError?.error?.code);

  const handleCaaReject = () => {
    logClickEvent('settings.domains.caa_reject')();
    setOpen(false);
    onDisconnect(domainName);
  };

  const handleCaaApprove = () => {
    logClickEvent('settings.domains.caa_approve')();
    caaRemediation.mutate({
      siteId,
      payload: {
        domainsToCreate: [{ fqdn: domainName, primary: false }],
        createCdn: true,
        consent: true,
      },
    });
  };

  const handleCaaRetry = () => {
    logClickEvent('settings.domains.caa_retry')();
    onConnect(domainName);
  };

  // Suppress the raw remediation error in the not-GD-managed case — the UI has
  // already switched to the self-service instructions for that path.
  const caaRemediationErrorMessage =
    !remediationNotGdManaged && caaRemediation.error instanceof Error
      ? caaRemediation.error.message
      : null;

  // CSP impression: domain-error panel shown (FAILED/ERROR/CDN error → /domain-errors).
  // Keyed per domain + error code so a re-render with the same error doesn't re-fire.
  useEffect(() => {
    if (!domainErrorMessage) return;
    const errorCode = domainError?.error?.code ?? 'unknown';
    const key = `${domainName}:${errorCode}`;
    if (errorShownRef.current === key) return;
    errorShownRef.current = key;
    logImpressionEvent('settings.domains.item_error_shown', {
      errorCode,
      action: domainError?.error?.action ?? '',
    })();
  }, [domainErrorMessage, domainName, domainError?.error?.code, domainError?.error?.action]);

  // CSP impression: CAA remediation banner shown (consent or self-service).
  // Keyed per domain + variant so a re-render with the same state doesn't re-fire.
  useEffect(() => {
    if (!caaVariant) return;
    const key = `${domainName}:${caaVariant}`;
    if (caaBannerShownRef.current === key) return;
    caaBannerShownRef.current = key;
    logImpressionEvent('settings.domains.caa_banner_shown', { variant: caaVariant })();
  }, [caaVariant, domainName]);

  // CSP impression: per-domain mutation error shown inline after a failed connect.
  useEffect(() => {
    if (!domainSpecificErrorMsg) return;
    if (mutationErrorShownRef.current === domainName) return;
    mutationErrorShownRef.current = domainName;
    logImpressionEvent('settings.domains.item_mutation_error')();
  }, [domainSpecificErrorMsg, domainName]);

  // CSP impression: status tag reaches Active or Failed/Error. Keyed per
  // domain + status so each transition fires once.
  useEffect(() => {
    const status = appDomain?.status;
    if (status !== DomainStatus.ACTIVE && status !== DomainStatus.FAILED && status !== DomainStatus.ERROR) {
      return;
    }
    const key = `${domainName}:${status}`;
    if (statusShownRef.current === key) return;
    statusShownRef.current = key;
    if (status === DomainStatus.ACTIVE) {
      logImpressionEvent('settings.domains.item_status_active')();
    } else {
      logImpressionEvent('settings.domains.item_status_failed')();
    }
  }, [appDomain?.status, domainName]);

  return (
    <Card space={{ inline: 'md', block: 'md' }} data-testid={`domain-row-${normalizeFqdn(domainName)}`}>
      <Box
        orientation="horizontal"
        blockAlignChildren="spaceBetween"
        inlineAlignChildren="center"
      >
        <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
          {showConnectionStepper && (
            <Button
              design="minimal"
              size="sm"
              className="!bg-transparent"
              icon={
                <ChevronDownIcon
                  className={`transition-transform duration-200 motion-reduce:transition-none text-intents-ux-box-foregroundColor ${stepperExpanded ? '' : '-rotate-90'}`}
                />
              }
              aria-expanded={stepperExpanded}
              aria-label={t('builder_domain_status_view_toggle_details')}
              onClick={() => setStepperExpanded((prev: boolean) => !prev)}
            />
          )}
          {isDomainConnectEnabled && radioMode ? (
            <Radio
              id={`domain-radio-${domainName}`}
              name="domain-selection"
              value={domainName}
              checked={isSelected}
              label={domainName}
              onChange={() => onSelect?.(domainName)}
            />
          ) : isConnected && appDomain?.status === DomainStatus.ACTIVE ? (
            <Button
              as="external"
              design="inline"
              data-eid={generateClickEID(`settings.domains.domain_link`)}
              className="!hover:bg-transparent"
              href={getDomainUrl(domainName)}
              external
              text={domainName}
            />
          ) : (
            <text.p>{domainName}</text.p>
          )}
          {showDomainStatusTag && (
            <Tag
              emphasis={
                hasDnsDrift
                  ? 'warning'
                  : polledStatus === 'SUCCESS' ||
                      polledOverallStatus === 'SUCCESS' ||
                      appDomain?.status === DomainStatus.ACTIVE
                    ? 'success'
                    : polledStatus === 'FAILED' ||
                        polledOverallStatus === 'FAILED' ||
                        appDomain?.status === DomainStatus.FAILED ||
                        appDomain?.status === DomainStatus.ERROR
                      ? 'critical'
                      : 'info'}
            >
              {hasDnsDrift
                ? t('builder_domain_status_dns_conflict', undefined, 'DNS changed')
                : connectedTagLabel}
            </Tag>
          )}
          {appId && appDomain?.status === DomainStatus.ACTIVE && (
            <DkimStatusBadge appId={appId} domain={domainName} />
          )}
        </Box>
        <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
          {showConnectionStepper && (
            <Button
              design="tertiary"
              size="sm"
              disabled={isJobFetching}
              icon={isJobFetching ? <Spinner size="sm" /> : <RefreshIcon />}
              text={t('builder_domain_status_view_check_status')}
              onClick={() => {
                logClickEvent('settings.domains.check_status_button')();
                handleRefreshJobStatus();
              }}
            />
          )}
          <Popover open={open} onOpenChange={handlePopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button design="minimal" size="sm" icon={<MenuIcon />} aria-label={t('builder_common_options', undefined, 'Options')} data-testid="domain-row-options-button" />
          </PopoverTrigger>
          <PopoverContent align="end" className={isDomainConnectEnabled ? "w-auto p-1" : "w-[280px] p-1"}>
            {showConfirmation ? (
              <DomainConnectConfirmation
                onConfirm={handleConfirmConnect}
                onCancel={handleCancelConnect}
                isInternalOnly
                isPrePublishConnect={isPrePublishConnect}
              />
            ) : isDomainConnectEnabled && radioMode ? (
              <div className="flex w-max flex-col gap-0.5">
                {isConnected && (
                  <Button
                    icon={<UnlinkIcon />}
                    design={isDomainConnectEnabled ? "option" : "tertiary"}
                    onClick={handleDisconnect}
                    disabled={isLoading}
                    data-eid={generateClickEID(
                      `settings-domains.custom_domain.disconnect`,
                    )}
                    text={t("builder_domain_button_disconnect")}
                    size="sm"
                    stretch={!isDomainConnectEnabled}
                    className={isDomainConnectEnabled ? "!justify-start whitespace-nowrap px-2" : "!justify-start"}
                  />
                )}
                {!isCustomDomain && (
                  <Button
                    icon={<EditIcon />}
                    design={isDomainConnectEnabled ? "option" : "tertiary"}
                    onClick={() => setOpen(false)}
                    data-eid={generateClickEID(
                      `settings-domains.custom_domain.manage`,
                    )}
                    text={t("builder_domain_button_manage")}
                    href={`https://dcc.godaddy.com/control/dnsmanagement?domainName=${domainName}`}
                    external
                    size="sm"
                    stretch={!isDomainConnectEnabled}
                    className={isDomainConnectEnabled ? "!justify-start whitespace-nowrap px-2" : "!justify-start"}
                  />
                )}
              </div>
            ) : (
              <Box orientation="vertical" gap="sm" inlineAlignChildren="start">
                {!isConnected && (
                  <Button
                    icon={<LinkIcon />}
                    design="tertiary"
                    onClick={handleConnectClick}
                    disabled={isLoading || disableConnect}
                    data-eid={generateClickEID(
                      `settings-domains.custom_domain.connect`,
                    )}
                    text={isPrePublishConnect
                      ? t('builder_domain_publish_and_connect', undefined, 'Publish and Connect')
                      : t('builder_domain_button_connect')}
                    size="sm"
                    stretch
                    className="!justify-start"
                  />
                )}
                {isConnected && (
                  <Button
                    icon={<UnlinkIcon />}
                    design="tertiary"
                    onClick={handleDisconnect}
                    disabled={isLoading}
                    data-eid={generateClickEID(
                      `settings-domains.custom_domain.disconnect`,
                    )}
                    text={t("builder_domain_button_disconnect")}
                    size="sm"
                    stretch
                    className="!justify-start"
                  />
                )}
                {!isCustomDomain && (
                  <Button
                    icon={<EditIcon />}
                    design="tertiary"
                    onClick={() => setOpen(false)}
                    data-eid={generateClickEID(
                      `settings-domains.custom_domain.manage`,
                    )}
                    text={t("builder_domain_button_manage")}
                    href={`https://dcc.godaddy.com/control/dnsmanagement?domainName=${domainName}`}
                    external
                    size="sm"
                    stretch
                    className="!justify-start"
                  />
                )}
              </Box>
            )}
          </PopoverContent>
        </Popover>
        </Box>
      </Box>
      {domainSpecificErrorMsg && (
        <Box className="mt-2">
          <text.p className="ux-text ux-text-caption ux-text-feedback-critical">{domainSpecificErrorMsg}</text.p>
        </Box>
      )}
      {!domainSpecificErrorMsg && caaVariant && (
        <Box className="mt-2" gap="md" inlineAlignChildren="start">
          <text.p className="ux-text ux-text-caption ux-text-feedback-critical">
            {t(
              'builder_domain_caa_action_required_title',
              { domain: domainName },
              'Action required to connect your app to {domain}',
            )}
          </text.p>
          {caaVariant === 'consent' ? (
            <>
              <text.p>
                {t(
                  'builder_domain_caa_internal_body',
                  {},
                  'Your domain has CAA DNS records that are preventing us from issuing the SSL certificate needed to connect your app to this domain. We can automatically remove the conflicting CAA records for you.',
                )}
              </text.p>
              <text.p className="font-semibold">
                {t('builder_domain_caa_internal_question', {}, 'Would you like us to remove them?')}
              </text.p>
              {caaRemediationErrorMessage && (
                <text.p className="ux-text ux-text-caption ux-text-feedback-critical">
                  {caaRemediationErrorMessage}
                </text.p>
              )}
              <Box orientation="horizontal" gap="md">
                <Button
                  design="primary"
                  size="sm"
                  text={caaRemediation.isPending
                    ? t('builder_domain_caa_approving', {}, 'Approving…')
                    : t('builder_domain_caa_approve', {}, 'Approve')}
                  onClick={handleCaaApprove}
                  disabled={caaRemediation.isPending}
                  data-eid={generateClickEID('settings.domains.caa_approve')}
                />
                <Button
                  design="secondary"
                  size="sm"
                  text={t('builder_domain_caa_reject', {}, 'Reject')}
                  onClick={handleCaaReject}
                  disabled={caaRemediation.isPending}
                  data-eid={generateClickEID('settings.domains.caa_reject')}
                />
              </Box>
            </>
          ) : (
            <>
              <text.p>
                {t(
                  'builder_domain_caa_external_body',
                  {},
                  "Your domain has CAA DNS records that are preventing us from issuing the SSL certificate needed to connect your app to this domain. Since this domain's DNS is managed outside of our platform, you'll need to remove the conflicting CAA records yourself.",
                )}
              </text.p>
              <text.p className="font-semibold">
                {t('builder_domain_caa_external_steps_title', {}, 'How to fix this:')}
              </text.p>
              <ol className="list-decimal ps-5">
                <li>
                  <text.span>
                    {t('builder_domain_caa_external_step_1', {}, "Log in to your domain's DNS provider.")}
                  </text.span>
                </li>
                <li>
                  <text.span>
                    {t('builder_domain_caa_external_step_2', {}, "Remove any existing CAA records that don't include our certificate issuers.")}
                  </text.span>
                </li>
                <li>
                  <text.span>
                    {t('builder_domain_caa_external_step_3', {}, 'Come back here and retry the connection.')}
                  </text.span>
                </li>
              </ol>
              <text.p className="ux-text ux-text-caption">
                {t('builder_domain_caa_external_footer', {}, "Until this is resolved, we won't be able to complete the domain setup.")}
              </text.p>
              <Box orientation="horizontal" gap="md">
                <Button
                  design="primary"
                  size="sm"
                  text={t('builder_domain_caa_retry', {}, 'Retry connection')}
                  onClick={handleCaaRetry}
                  data-eid={generateClickEID('settings.domains.caa_retry')}
                />
                <Button
                  design="secondary"
                  size="sm"
                  as="external"
                  href={config?.supportUrl}
                  external
                  text={t('builder_common_contact_support', {}, 'Contact us')}
                  data-eid={generateClickEID('settings.domains.caa_contact_support')}
                />
              </Box>
            </>
          )}
        </Box>
      )}
      {!domainSpecificErrorMsg && !caaVariant && domainErrorMessage && (!isConnectionStatusViewEnabled || (appDomain?.status !== DomainStatus.FAILED && appDomain?.status !== DomainStatus.ERROR)) && (
        <Box className="mt-2">
          <text.p className="ux-text ux-text-caption">
            {domainError?.error?.action === 'CONTACT_SUPPORT' ? (
              <span>{domainErrorMessage}&nbsp;
                <Button
                  className="ux-text ux-text-caption ux-text-link"
                  design="inline"
                  href={config?.supportUrl}
                  external
                  text={t('builder_common_contact_support')}
                />
              </span>
            ) : domainError?.error?.action === 'RETRY' ? (
              <span>{domainErrorMessage}&nbsp;
                {t('builder_domain_error_please_retry')}&nbsp;
                {t('builder_domain_error_if_issue_persists')}&nbsp;
                <Button
                  className="ux-text ux-text-caption ux-text-link"
                  design="inline"
                  href={config?.supportUrl}
                  external
                  text={t('builder_common_contact_support')}
                />
              </span>
            ) : (
              <span>{domainErrorMessage}&nbsp;
                {t('builder_domain_disconnect_and_reconnect')}&nbsp;
                <Button
                  className="ux-text ux-text-caption ux-text-link"
                  design="inline"
                  href={config?.supportUrl}
                  external
                  text={t('builder_common_contact_support')}
                />
              </span>
            )}
          </text.p>
        </Box>
      )}
      {hasDnsDrift && (
        <Box className="mt-2">
          <text.p className="ux-text ux-text-caption ux-text-feedback-critical">
            {t('builder_domain_dns_drift_explanation', undefined, 'Your DNS settings were changed. Reconnect if you want your app to work again with the domain.')}
          </text.p>
        </Box>
      )}
      {showConnectionStepper && stepperExpanded && (
        <DomainConnectionStatusStepper
          fqdn={domainName}
          siteId={siteId}
          steps={polledSteps}
          overallStatus={polledOverallStatus}
          appDomainStatus={appDomain?.status}
          domainError={domainError}
          onRefresh={handleRefreshJobStatus}
          onDisconnect={() => onDisconnect(domainName)}
          isRefreshing={isJobFetching}
        />
      )}
    </Card>
  );
}
