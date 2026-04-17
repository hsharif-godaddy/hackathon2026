'use client';

import { useMemo, useState } from 'react';
import Button from '@ux/button';
import WindowNewIcon from '@ux/icon/window-new';

import IconButton from '@/app/develop/components/IconButton';
import { ChatTab, MobileMode, SettingsSection } from '@/app/develop/components/types';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

export default function DomainMenu() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const [open, setOpen] = useState(false);
  const { setActiveChatTab, setActiveSettingsSection } = useChatTabs();

  const site = useDevelopPageStore((state) => state.site);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange);

  const previewUrl = site?.preview_url;
  const publishedUrl = site?.published_url;
  const hasPublishedUrl = publishedUrl && hasBeenPublished(site);

  const handleUrlClick = (url: string, type: 'preview' | 'publish') => {
    logClickEvent(
      type === 'preview' ? 'develop.header.open_preview' : 'develop.header.open_published',
      clickContext,
    )();
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);

    shipAnalyticsLog('domain.url.clicked', {
      appId,
      type,
    });
  };

  const handleDomainSettings = () => {
    logClickEvent('develop.header.domain_settings', clickContext)();
    setOpen(false);
    setActiveSettingsSection(SettingsSection.DOMAIN);
    setActiveChatTab(ChatTab.SETTINGS);
    if (isMobile) {
      handleMobileModeChange(MobileMode.TOOLS);
    }
  };

  // If no URLs available, disable the button
  const isDisabled = !previewUrl && !hasPublishedUrl;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <IconButton
            icon={<WindowNewIcon className="size-2.5" />}
            label={t('builder_domain_button_visit')}
            showLabelWhenActive={false}
            onClick={() => {
              logClickEvent('develop.header.domain', clickContext)();
              setOpen(!open);
            }}
            disabled={isDisabled}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-1">
        <div className="flex flex-col gap-0.5">
          {previewUrl && (
            <Button
              design="option"
              size="sm"
              text={t('builder_domain_menu_preview')}
              className="!justify-start"
              onClick={() => handleUrlClick(previewUrl, 'preview')}
            />
          )}
          {hasPublishedUrl && (
            <Button
              design="option"
              size="sm"
              text={t('builder_domain_menu_published')}
              className="!justify-start"
              onClick={() => handleUrlClick(publishedUrl, 'publish')}
            />
          )}
          <Separator />
          <Button
            design="option"
            size="sm"
            text={t('builder_project_domain_title')}
            className="!justify-start"
            onClick={handleDomainSettings}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
