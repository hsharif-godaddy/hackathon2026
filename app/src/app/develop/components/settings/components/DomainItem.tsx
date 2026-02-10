import { useState } from "react";
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
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus } from '@/lib/control-plane/types';
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/shadcn/popover"
import { generateClickEID } from '@/utils/instrumentation';
import DomainConnectConfirmation from './DomainConnectConfirmation';

function getDomainUrl(domain: string): string {
  if (!domain) return '';
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  return `https://${domain}`;
}

/**
 * Get translated status label based on domain connection status
 */
function getStatusLabel(appDomain: AppDomain | undefined, t: ReturnType<typeof useTranslations>): string {
  if (!appDomain) return t('builder_domain_status_not_connected');
  if (appDomain.status === DomainStatus.ACTIVE) return t('builder_domain_status_active');
  if (appDomain.status === DomainStatus.PENDING || !appDomain.status) return t('builder_domain_status_pending');
  if (appDomain.status === DomainStatus.FAILED) return t('builder_domain_status_error');
  if (appDomain.status === DomainStatus.DELETING) return t('builder_domain_status_deleting');
  return appDomain.status;
}

export default function DomainItem({
  domain,
  appDomain,
  onConnect,
  onDisconnect,
  isLoading = false,
  disableConnect = false,
  isCustomDomain = false,
}: {
  domain: Domain;
  appDomain?: AppDomain;
  onConnect: (domainName: string) => void;
  onDisconnect: (domainName: string) => void;
  isLoading?: boolean;
  disableConnect?: boolean;
  isCustomDomain?: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const domainName = domain.domain || domain.name || '';
  const isConnected = !!appDomain;
  const statusLabel = getStatusLabel(appDomain, t);

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
                appDomain?.status === DomainStatus.ACTIVE ? "success" : "info"
              }
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
                      `settings/domains.custom_domain.connect`,
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
                      `settings/domains.custom_domain.disconnect`,
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
                      `settings/domains.custom_domain.manage`,
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
    </Card>
  );
}
