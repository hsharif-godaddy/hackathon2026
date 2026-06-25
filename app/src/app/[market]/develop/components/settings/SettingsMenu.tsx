'use client';

import clsx from 'clsx';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Button from '@ux/button';
import GraphIcon from '@ux/icon/graph';
import HistoryIcon from '@ux/icon/history';
import MenuIcon from '@ux/icon/menu';
import SparklesIcon from '@ux/icon/sparkles';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup';
import { useSettingsNavItems } from '@/app/[market]/develop/components/settings/useSettingsNavItems';
import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useSettingsNotifications } from '@/hooks/useSettingsNotifications';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/lib/shadcn/popover';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation';

export interface SettingsMenuRef {
  openPopover: () => void;
  closePopover: () => void;
  togglePopover: () => void;
  isOpen: () => boolean;
}

const SettingsMenu = forwardRef<SettingsMenuRef>((props, ref) => {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);

  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges);
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange);
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange);

  const isSecurityScanUiEnabled = useSwitchboard('appbuilder-security-scan-ui') === true;
  const isAutomationsEnabled = useSwitchboard('appbuilder-automations');
  const isAnalyticsEnabled = useSwitchboard('appbuilder-analytics');

  // Background tasks owned by settings sub-tabs surface a spinner on the toolbar button.
  // For now only the security analysis triggers it; OR additional sources in here as they land.
  const isSecurityAnalysisRunning = useDevelopPageStore(
    (state) => !!(appId && state.publishStates[appId]?.isSecurityAnalysisRunning)
  );
  const isBackgroundActivityRunning = isSecurityScanUiEnabled && isSecurityAnalysisRunning;

  const { activeChatTab, activeSettingsSection, setActiveSettingsSection, setActiveChatTab } = useChatTabs();

  // Session-scoped "action needed" dots, raised when a settings sub-task completes (e.g. security scan)
  // and cleared once the user visits that section. Drives both the toolbar corner badge and per-item dots.
  // Pass undefined when the feature is off so the hook returns an empty set and no dots are shown.
  const settingsNotifications = useSettingsNotifications(isSecurityScanUiEnabled ? appId : undefined);
  // Toolbar corner badge.
  const notificationDot = (
    <span className="size-1 shrink-0 rounded-full bg-intents-ux-feedbackHighContrastCritical-feedbackColor" />
  );
  // Popover item dot: a flex-item ::after pinned immediately to the right of the button label,
  // so it tracks any label width and survives the button's full-width row without overlay math.
  const itemDotClass =
    "after:ml-2 after:inline-block after:size-1 after:shrink-0 after:self-center after:rounded-full after:bg-intents-ux-feedbackHighContrastCritical-feedbackColor after:content-['']";

  useImperativeHandle(ref, () => ({
    openPopover: () => setOpen(true),
    closePopover: () => setOpen(false),
    togglePopover: () => setOpen(prev => !prev),
    isOpen: () => open,
  }));

  const handleAutomationsClick = () => {
    handleMobileModeChange(MobileMode.PREVIEW);
    handleViewModeChange(ViewMode.AUTOMATIONS, hasUnsavedChanges);
    setOpen(false);
  };

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id);
    setActiveChatTab(ChatTab.SETTINGS);
    setOpen(false);
  };

  const isOnSettingsTab = activeChatTab === ChatTab.SETTINGS;

  const items = useSettingsNavItems();

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <ButtonGroup.Item
          ref={anchorRef}
          value={ChatTab.SETTINGS}
          icon={<MenuIcon className="size-2.5" />}
          adornment={
            isBackgroundActivityRunning ? (
              <Spinner size="sm" data-partial="componentAiro" className="size-2.5 shrink-0" />
            ) : undefined
          }
          cornerBadge={settingsNotifications.hasAny ? notificationDot : undefined}
          label={t('builder_chat_toolbar_button_settings')}
          onClick={() => setOpen(prev => !prev)}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="chat-toolbar-settings-button"
        />
        </PopoverAnchor>
      <PopoverContent
        align={isMobile ? "center" : "end"}
        className="max-h-[min(70vh,28rem)] overflow-y-auto p-1"
        onInteractOutside={(e) => {
          // Anchor clicks are toggled externally via the ButtonGroup onChange → togglePopover ref; suppress Radix dismiss
          if (anchorRef.current?.contains(e.target as Node)) {
            e.preventDefault();
            return;
          }
          // Non-anchor outside clicks close the popover
          setOpen(false);
        }}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="flex flex-col gap-0.5">
          {isMobile && (
            <>
              {isAutomationsEnabled && (
                <Button
                  design="option"
                  size="sm"
                  icon={<SparklesIcon />}
                  text={t('builder_header_button_automations', undefined, 'Automations')}
                  className="!justify-start"
                  data-testid="settings-automations-item"
                  onClick={handleAutomationsClick}
                />
              )}
              <Button
                design="option"
                size="sm"
                active={activeChatTab === ChatTab.HISTORY}
                icon={<HistoryIcon />}
                text={t('builder_chat_toolbar_button_history')}
                className="!justify-start"
                data-testid="settings-menu-history-item"
                onClick={() => {
                  logClickEvent('develop.settings_menu.history', clickContext)();
                  setActiveChatTab(ChatTab.HISTORY);
                  setOpen(false);
                }}
              />
              {isAnalyticsEnabled && (
                <Button
                  design="option"
                  size="sm"
                  active={activeChatTab === ChatTab.ANALYTICS}
                  icon={<GraphIcon className="rtl:scale-x-[-1]" />}
                  text={t('builder_settings_nav_analytics')}
                  className="!justify-start"
                  data-testid="settings-menu-analytics-item"
                  onClick={() => {
                    logClickEvent('develop.settings_menu.analytics', clickContext)();
                    setActiveChatTab(ChatTab.ANALYTICS);
                    setOpen(false);
                  }}
                />
              )}
              {items.length > 0 && (
                <div
                  role="separator"
                  className="my-1 h-px bg-intents-ux-box-borderColor"
                />
              )}
            </>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex flex-col">
              <Button
                design="option"
                size="sm"
                active={isOnSettingsTab && activeSettingsSection === item.id}
                icon={item.icon}
                text={item.label}
                disabled={item.disabled}
                className={clsx('!justify-start', settingsNotifications.has(item.id) && itemDotClass)}
                data-testid={item.testId}
                onClick={() => {
                  logClickEvent(`develop.settings_menu.${item.id}`, clickContext)();
                  if (item.onClick) {
                    item.onClick();
                    setOpen(false);
                  } else {
                    handleNavigate(item.id);
                  }
                }}
              />
              {item.loadingLabel && (
                <text.span
                  size={-1}
                  className="flex items-center gap-1 pb-1 text-intents-ux-textSubtle-textColor"
                  style={{ paddingInlineStart: 'calc(1rem + 2em)' }}
                >
                  <Spinner size="sm" data-partial="componentAiro" className="shrink-0" />
                  {item.loadingLabel}
                </text.span>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});

SettingsMenu.displayName = 'SettingsMenu';

export default SettingsMenu;
