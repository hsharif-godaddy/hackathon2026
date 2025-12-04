import { useState } from "react";
import { useTranslations } from '@/hooks/useTranslations';
import CircleIcon from '@ux/icon/circle';
import CircleHalfIcon from '@ux/icon/circle-half';
import MenuIcon from '@ux/icon/menu';
import EditIcon from '@ux/icon/edit';
import WindowNewIcon from '@ux/icon/window-new';
import Spinner from '@ux/spinner';
import OkIcon from '@ux/icon/ok';
import Button from "@ux/button";
import text from "@ux/text";
import Tag from "@ux/tag";
import Box from "@ux/box";
import { DomainStatus } from '@/lib/control-plane/types';
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/shadcn/popover"
import DomainConnectConfirmation from './DomainConnectConfirmation';
import { generateClickEID } from '@/utils/instrumentation';
import type { AppDomain } from '@/hooks/useAppDetails';
import type { Domain } from '@/hooks/useDomainsQuery';

function getDomainUrl(domain: string): string {
  if (!domain) return '';
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  return `https://${domain}`;
}

/**
 * Get status icon and color based on domain connection status
 *
 * @param appDomain - App domain object with status information
 * @param intl - IntlShape instance for translations
 * @returns Object with icon component, CSS class, and translated label
 */
function getDomainStatusInfo(appDomain: AppDomain | undefined, t: ReturnType<typeof useTranslations>) {
  if (!appDomain) {
    return { 
      icon: CircleIcon, 
      className: 'text-intents-ux-text-subtle', 
      label: t('builder_domain_status_not_connected') 
    };
  }

  if (appDomain.status === DomainStatus.ACTIVE) {
    return { 
      icon: OkIcon, 
      className: 'text-intents-ux-text-success', 
      label: t('builder_domain_status_active') 
    };
  }

  // Check if domain is pending
  if (appDomain.status === DomainStatus.PENDING || !appDomain.status) {
    return { 
      icon: CircleHalfIcon, 
      className: 'text-intents-ux-text-info', 
      label: t('builder_domain_status_pending') 
    };
  }

  // Error state
  if (appDomain.status === DomainStatus.FAILED) {
    return { 
      icon: CircleIcon, 
      className: 'text-intents-ux-text-destructive', 
      label: t('builder_domain_status_error') 
    };
  }

  // Deleting state
  if (appDomain.status === DomainStatus.DELETING) {
    return { 
      icon: Spinner, 
      className: 'text-intents-ux-text-subtle', 
      label: t('builder_domain_status_deleting') 
    };
  }

  return { icon: CircleIcon, className: 'text-intents-ux-text-subtle', label: appDomain.status };
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
  const statusInfo = getDomainStatusInfo(appDomain, t);
  const StatusIcon = statusInfo.icon;

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
    <Box
      orientation="horizontal"
      className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1.5"
      blockAlignChildren="spaceBetween"
      inlineAlignChildren="center"
    >
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        <StatusIcon className={`size-3 ${statusInfo.className}`} />
        <Box orientation="horizontal" gap="md">
        {isConnected && appDomain?.status === DomainStatus.ACTIVE ? (
            <Button
              design="inline"
              data-eid={generateClickEID(`settings/domains.domain_item.link`)}
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
            <Tag emphasis={appDomain?.status === DomainStatus.ACTIVE ? 'success' : 'info'}>
              {statusInfo.label}
            </Tag>
          )}
        </Box>
      </Box>
      <Popover open={open} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger className="hover:cursor-pointer">
          <MenuIcon className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[280px] p-1">
          {showConfirmation ? (
            <DomainConnectConfirmation
              onConfirm={handleConfirmConnect}
              onCancel={handleCancelConnect}
              isInternalOnly
            />
          ) : (
            <div className="flex flex-col gap-0.5 items-stretch">
              {!isConnected ? (
                <Button
                  icon={<OkIcon />}
                  design="tertiary"
                  onClick={handleConnectClick}
                  disabled={isLoading || disableConnect}
                  data-eid={generateClickEID(`settings/domains.custom_domain.connect`)}
                  text={t('builder_domain_button_connect')}
                />
              ) : (
                <Button
                  icon={<CircleIcon />}
                  design="tertiary"
                  onClick={handleDisconnect}
                  disabled={isLoading}
                  data-eid={generateClickEID(`settings/domains.custom_domain.disconnect`)}
                  text={t('builder_domain_button_disconnect')}
                />
              )}
              {!isCustomDomain && (
                <Button
                  icon={<EditIcon />}
                  design="tertiary"
                  onClick={() => setOpen(false)}
                  data-eid={generateClickEID(`settings/domains.custom_domain.manage`)}
                  text={t('builder_domain_button_manage')}
                  href={`https://dcc.godaddy.com/control/dnsmanagement?domainName=${domainName}`}
                  external
                />
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </Box>
  );
}
