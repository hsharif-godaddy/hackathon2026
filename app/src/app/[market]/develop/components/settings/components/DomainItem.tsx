import { useEffect, useRef, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import EditIcon from '@ux/icon/edit';
import LinkIcon from '@ux/icon/link';
import MenuIcon from '@ux/icon/menu';
import UnlinkIcon from '@ux/icon/unlink';
import Radio from "@ux/radio";
import Tag from "@ux/tag";
import text from "@ux/text";

import type { AppDomain } from '@/hooks/useAppDetails';
import { useDomainConflictCheck } from '@/hooks/useDomainConflictCheck';
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
import { defaultMessageForDomainJobLabelKey } from '@/lib/translations/domain-job-label-defaults';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { translateDomainApiError } from '@/utils/domain-validation';
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { DkimStatusBadge } from './DkimStatusBadge';
import DomainConnectConfirmation from './DomainConnectConfirmation';

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
  mutationError = null
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
}) {
  const t = useTranslations();
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');
  const queryClient = useQueryClient();
  const { config } = useGasketConfig();
  const [open, setOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [domainError, setDomainError] = useState<AiroDomainErrorResponse | null>(null);
  const errorShownRef = useRef<string | null>(null); // keyed on domainName + errorCode
  const mutationErrorShownRef = useRef<string | null>(null); // keyed on domainName
  const statusShownRef = useRef<string | null>(null); // keyed on domainName + status
  const domainName = domain.domain || domain.name || '';
  /** True when app details include this domain (any status: PENDING, ACTIVE, …). Not the same as “ACTIVE only”. */
  const isConnected = !!appDomain;
  const { hasDnsDrift } = useDomainConflictCheck(
    appId ?? siteId,
    domainName,
    appDomain?.anycastIp,
    isConnected && appDomain?.status === DomainStatus.ACTIVE,
  );
  const domainJobForApp = useDevelopPageStore((s) => s.domainJobsInProgress[siteId]);
  const activeJobForDomain =
    domainJobForApp && domainJobForApp.fqdn === domainName.trim().toLowerCase()
      ? domainJobForApp
      : null;
  const shouldPollJob =
    Boolean(activeJobForDomain)
    || (isCustomDomain
      && appDomain != null
      && (appDomain.status == null || appDomain.status === DomainStatus.PENDING));
  const {
    labelKey: polledLabelKey,
    status: polledStatus,
    overallStatus: polledOverallStatus,
    error: jobPollError,
  } = useDomainJobPolling(
    siteId,
    domainName,
    shouldPollJob,
  );

  const translatedPolledLabel = polledLabelKey
    ? t(
        polledLabelKey,
        undefined,
        defaultMessageForDomainJobLabelKey(polledLabelKey),
      )
    : null;

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
          useDevelopPageStore.getState().clearDomainJobInProgress(siteId);
        }
        return;
      }
      if (!activeJobForDomain) {
        return;
      }
      if (polledTerminal) {
        useDevelopPageStore.getState().clearDomainJobInProgress(siteId);
        return;
      }
      if (!appDomain) return;
      const { status } = appDomain;
      if (status !== DomainStatus.ACTIVE && status !== DomainStatus.FAILED) return;
      useDevelopPageStore.getState().clearDomainJobInProgress(siteId);
    }
    clearJobWhenTerminal();
  }, [siteId, activeJobForDomain, appDomain?.status, polledTerminal, jobPollError, domainName]);

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
    <Card space={{ inline: 'md', block: 'md' }}>
      <Box
        orientation="horizontal"
        blockAlignChildren="spaceBetween"
        inlineAlignChildren="center"
      >
        <Box orientation="horizontal" gap="md">
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
        <Popover open={open} onOpenChange={handlePopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button design="minimal" size="sm" icon={<MenuIcon />} aria-label={t('builder_common_options', undefined, 'Options')} />
          </PopoverTrigger>
          <PopoverContent align="end" className={isDomainConnectEnabled ? "w-auto p-1" : "w-[280px] p-1"}>
            {showConfirmation ? (
              <DomainConnectConfirmation
                onConfirm={handleConfirmConnect}
                onCancel={handleCancelConnect}
                isInternalOnly
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
                    text={t("builder_domain_button_connect")}
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
      {domainSpecificErrorMsg && (
        <Box className="mt-2">
          <text.p className="ux-text ux-text-caption ux-text-feedback-critical">{domainSpecificErrorMsg}</text.p>
        </Box>
      )}
      {!domainSpecificErrorMsg && domainErrorMessage && (
        <Box className="mt-2">
          <text.p className="ux-text ux-text-caption">
            {domainError?.error?.action === 'CONTACT_SUPPORT' ? (
              <span>{domainErrorMessage}&nbsp;
                <Button
                  className="ux-text ux-text-caption ux-text-link"
                  design="inline"
                  href={config.supportUrl}
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
                  href={config.supportUrl}
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
                  href={config.supportUrl}
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
    </Card>
  );
}
