import { useEffect, useState } from "react";
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import EditIcon from '@ux/icon/edit';
import LinkIcon from '@ux/icon/link';
import MenuIcon from '@ux/icon/menu';
import UnlinkIcon from '@ux/icon/unlink';
import WindowNewIcon from '@ux/icon/window-new';
import Tag from "@ux/tag";
import text from "@ux/text";

import type { AppDomain } from '@/hooks/useAppDetails';
import type { Domain } from '@/hooks/useDomainsQuery';
import { useGasketConfig } from '@/hooks/useGasketConfig';
import { DomainMutationError } from '@/hooks/useModifyDomains';
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus } from '@/lib/control-plane/types';
import type { AiroDomainErrorResponse } from '@/lib/mgmt-airo';
import { CdnStatus } from "@/lib/mgmt-airo/types";
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/shadcn/popover"
import { translateDomainApiError } from '@/utils/domain-validation';
import { generateClickEID } from '@/utils/instrumentation';
import DomainConnectConfirmation from './DomainConnectConfirmation';

function getDomainUrl(domain: string): string {
  if (!domain) {return '';}
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  return `https://${domain}`;
}

function getDomainSpecificError(error: Error | null, domainName: string, _t: ReturnType<typeof useTranslations>): string | null {
  if (!error || !domainName) {return null;}
  if (error instanceof DomainMutationError) {
    return error.details.domainSpecificError?.[domainName.trim().toLowerCase()] ?? null;
  }
  return null;
}

/**
 * Get translated status label based on domain connection status
 */
function getStatusLabel(appDomain: AppDomain | undefined, t: ReturnType<typeof useTranslations>): string {
  if (!appDomain) {return t('builder_domain_status_not_connected');}
  if (appDomain.status === DomainStatus.ACTIVE) {return t('builder_domain_status_active');}
  if (appDomain.status === DomainStatus.PENDING || !appDomain.status) {return t('builder_domain_status_pending');}
  if (appDomain.status === DomainStatus.FAILED || appDomain.status === DomainStatus.ERROR) {return t('builder_domain_status_error');}
  if (appDomain.status === DomainStatus.DELETING) {return t('builder_domain_status_deleting');}
  return appDomain.status;
}

export default function DomainItem({
  domain,
  appDomain,
  siteId,
  onConnect,
  onDisconnect,
  isLoading = false,
  disableConnect = false,
  isCustomDomain = false,
  mutationError = null
}: {
  domain: Domain;
  appDomain?: AppDomain;
  siteId: string;
  onConnect: (domainName: string) => void;
  onDisconnect: (domainName: string) => void;
  isLoading?: boolean;
  disableConnect?: boolean;
  isCustomDomain?: boolean;
  mutationError?: Error | null;
}) {
  const t = useTranslations();
  const { config } = useGasketConfig();
  const [open, setOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [domainError, setDomainError] = useState<AiroDomainErrorResponse | null>(null);
  const domainName = domain.domain || domain.name || '';
  const isConnected = !!appDomain;
  const statusLabel = getStatusLabel(appDomain, t);

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
    setShowConfirmation(true);
  };

  const handleConfirmConnect = () => {
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

  return (
    <Card space={{ inline: 'md', block: 'md' }}>
      <Box
        orientation="horizontal"
        blockAlignChildren="spaceBetween"
        inlineAlignChildren="center"
      >
        <Box orientation="horizontal" gap="md">
          {isConnected && appDomain?.status === DomainStatus.ACTIVE ? (
            <Button
              design="inline"
              data-eid={generateClickEID(`settings.domains.domain_link`)}
              className="!hover:bg-transparent"
              href={getDomainUrl(domainName)}
              external
            >
              <Box
                className="w-auto"
                orientation="horizontal"
                gap="sm"
                inlineAlignChildren="center"
                blockAlignChildren="start"
              >
                <text.p>{domainName}</text.p>
                <WindowNewIcon className="size-2" />
              </Box>
            </Button>
          ) : (
            <text.p>{domainName}</text.p>
          )}
          {isConnected && (
            <Tag
              emphasis={
                appDomain?.status === DomainStatus.ACTIVE
                  ? "success"
                  : appDomain?.status === DomainStatus.FAILED || appDomain?.status === DomainStatus.ERROR
                    ? "critical"
                    : "info"}
            >
              {statusLabel}
            </Tag>
          )}
        </Box>
        <Popover open={open} onOpenChange={handlePopoverOpenChange}>
          <PopoverTrigger>
            <Button design="minimal" size="sm" icon={<MenuIcon />} />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[280px] p-1">
            {showConfirmation ? (
              <DomainConnectConfirmation
                onConfirm={handleConfirmConnect}
                onCancel={handleCancelConnect}
                isInternalOnly
              />
            ) : (
              <Box orientation="vertical" gap="sm" inlineAlignChildren="start">
                {!isConnected ? (
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
                ) : (
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
                <Button className="ux-text ux-text-caption ux-text-link" design="inline" href={config.supportUrl} external>
                  {t('builder_common_contact_support')}
                </Button>
              </span>
            ) : domainError?.error?.action === 'RETRY' ? (
              <span>{domainErrorMessage}&nbsp;
                {t('builder_domain_error_please_retry')}&nbsp;
                {t('builder_domain_error_if_issue_persists')}&nbsp;
                <Button className="ux-text ux-text-caption ux-text-link" design="inline" href={config.supportUrl} external>
                  {t('builder_common_contact_support')}
                </Button>
              </span>
            ) : (
              <span>{domainErrorMessage}&nbsp;
                {t('builder_domain_disconnect_and_reconnect')}&nbsp;
                <Button className="ux-text ux-text-caption ux-text-link" design="inline" href={config.supportUrl} external>
                  {t('builder_common_contact_support')}
                </Button>
              </span>
            )}
          </text.p>
        </Box>
      )}
    </Card>
  );
}
