import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/shadcn/popover"
import { generateClickEID } from '@/utils/instrumentation';
import type { AppDomain } from '@/hooks/useDomainOperations';
import type { Domain } from '@/hooks/useDomainsQuery';
import CircleIcon from '@ux/icon/circle';
import CircleHalfIcon from '@ux/icon/circle-half';
import MenuIcon from '@ux/icon/menu';
import EditIcon from '@ux/icon/edit';
import Spinner from '@ux/spinner';
import OkIcon from '@ux/icon/ok';
import LinkIcon from '@ux/icon/link';
import Button from "@ux/button";
import text from "@ux/text";
import Box from "@ux/box";
import Tag from "@ux/tag";

/**
 * Get status icon and color based on domain connection status
 */
function getDomainStatusInfo(appDomain?: AppDomain) {
  if (!appDomain) {
    return { icon: CircleIcon, className: 'text-intents-ux-text-subtle', label: 'Not connected' };
  }

  // Check if domain is fully active
  if (appDomain.status === 'active') {
    return { icon: OkIcon, className: 'text-intents-ux-text-success', label: 'Active' };
  }

  // Check if domain is pending
  if (appDomain.status === 'pending' || !appDomain.status) {
    return { icon: CircleHalfIcon, className: 'text-intents-ux-text-info', label: 'Pending' };
  }

  // Error state
  if (appDomain.status === 'error') {
    return { icon: CircleIcon, className: 'text-intents-ux-text-destructive', label: 'Error' };
  }

  // Deleting state
  if (appDomain.status === 'deleting') {
    return { icon: Spinner, className: 'text-intents-ux-text-subtle', label: 'Deleting' };
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
  const [open, setOpen] = useState(false);
  const domainName = domain.domain || domain.name || '';
  const isConnected = !!appDomain;
  const statusInfo = getDomainStatusInfo(appDomain);
  const StatusIcon = statusInfo.icon;

  const handleConnect = () => {
    setOpen(false);
    onConnect(domainName);
  };

  const handleDisconnect = () => {
    setOpen(false);
    onDisconnect(domainName);
  };

  return (
    <Box
      orientation="horizontal"
      className="bg-intents-ux-box-backgroundColor rounded-lg px-4 py-3"
      blockAlignChildren="spaceBetween"
      inlineAlignChildren="center"
    >
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        <StatusIcon className={`size-6 ${statusInfo.className}`} />
        <Box orientation="horizontal" gap="md">
          <text.p>{domainName}</text.p>
          {isConnected && (
            <Tag emphasis="passive">
              {statusInfo.label}
            </Tag>
          )}
        </Box>
      </Box>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="hover:cursor-pointer">
          <MenuIcon className="size-6" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[250px] p-2">
          <div className="flex flex-col gap-1 items-stretch">
            {!isConnected ? (
              <Button
                icon={<OkIcon />}
                design="tertiary"
                onClick={handleConnect}
                disabled={isLoading || disableConnect}
                data-eid={generateClickEID(`settings/domains.custom_domain.connect`)}
                text="Connect Domain"
              />
            ) : (
              <Button
                icon={<CircleIcon />}
                design="tertiary"
                onClick={handleDisconnect}
                disabled={isLoading}
                data-eid={generateClickEID(`settings/domains.custom_domain.disconnect`)}
                text="Disconnect Domain"
              />
            )}
            {!isCustomDomain && (
              <Button
                icon={<EditIcon />}
                design="tertiary"
                onClick={() => setOpen(false)}
                data-eid={generateClickEID(`settings/domains.custom_domain.manage`)}
                text="Manage Domain"
                href={`https://dcc.godaddy.com/control/dnsmanagement?domainName=${domainName}`}
                external
              />
            )}
            <Button
              icon={<LinkIcon />}
              design="tertiary"
              data-eid={generateClickEID(`settings/domains.custom_domain.visit`)}
              text="Visit Site"
              href={`https://${domainName}`}
              external
            />
          </div>
        </PopoverContent>
      </Popover>
    </Box>
  );
}
