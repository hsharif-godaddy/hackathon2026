'use client';

import { motion } from 'framer-motion';
import { type ReactNode, useMemo } from 'react';
import Box from '@ux/box';
import Apps2Icon from '@ux/icon/apps2'
import CodeIcon from '@ux/icon/code'
import ColorPaletteIcon from '@ux/icon/color-palette'
import ConversationsIcon from '@ux/icon/conversations'
import HelpIcon from '@ux/icon/help'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WorldIcon from '@ux/icon/world'

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup';
import { MOBILE_MODE_EID_MAP, VIEW_MODE_EID_MAP } from '@/app/[market]/develop/components/headerEids';
import IconButton from '@/app/[market]/develop/components/IconButton';
import ShareLink from '@/app/[market]/develop/components/layout/ShareLink';
import DeviceSelector from '@/app/[market]/develop/components/preview/DeviceSelector'
import { MobileMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import AppPublish from '@/components/layout/AppPublish';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import UserMenu from '@/components/layout/UserMenu';
import { useSupportChat } from '@/hooks/useSupportChat';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import {
  useCommanderCanvasEnabled,
  useCommanderCanvasTabsEnabled,
  useCommanderStore,
  useEffectiveCommanderPosition,
} from '@/stores/useCommanderStore';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation'
import { CommanderCanvasMenu } from './CommanderCanvasMenu'
import { CanvasTabs } from '../canvas/CanvasTabs'
import { CommanderPosition } from '../types'

const LOCATION = 'develop';

interface CommanderHeaderProps {
  desktopLogo: ReactNode;
  mobileLogo: ReactNode;
}

export default function CommanderHeader({ desktopLogo, mobileLogo }: CommanderHeaderProps) {
  const t = useTranslations();
  const isBrandBookEnabled = useSwitchboard('appbuilder-brandbook');
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button');
  const isHelpButtonEnabled = useSwitchboard('appbuilder-help-button');
  const isCanvasEnabled = useCommanderCanvasEnabled();
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled();
  const isCanvasSettingsOpen = useCommanderStore((state) => state.isCanvasSettingsOpen);
  const closeCanvasSettings = useCommanderStore((state) => state.closeCanvasSettings);
  const isLeftDock = useEffectiveCommanderPosition() === CommanderPosition.LeftDock
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const { launchSupportChat } = useSupportChat();

  const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange)

  const handleViewModeButtonChange = (value: ViewMode) => {
    handleViewModeChange(value, hasUnsavedChanges)
    if (VIEW_MODE_EID_MAP[value]) logClickEvent(VIEW_MODE_EID_MAP[value], clickContext)()
  }

  // Inactive while the canvas settings sheet is up — clicking the button dismisses the sheet.
  const isPreviewActive =
    !isCanvasSettingsOpen && (viewMode === ViewMode.PREVIEW || viewMode === ViewMode.EDIT)

  return (
    <header data-testid="commander-header" className="flex">
      <motion.div
        className="shrink-0 flex items-center gap-1.5"
        animate={{ width: 'auto' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {isMobile ? mobileLogo : desktopLogo}
      </motion.div>

      {!isMobile && (
        <div className="px-1.5 py-1 md:px-2.5 md:py-1 grow">
          <Box
            orientation="horizontal"
            blockAlignChildren="spaceBetween"
            inlineAlignChildren="center"
            gap="sm"
          >
            <Box
              orientation="horizontal"
              gap="sm"
              inlineAlignChildren="center"
              blockAlignChildren={isLeftDock ? 'start' : 'center'}
              stretch
            >
              <motion.div
                layout="position"
                transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.9 }}
                className="flex items-center gap-1.5"
              >
                {isCanvasTabsEnabled ? (
                  <CanvasTabs clickContext={clickContext} />
                ) : (
                  <>
                    <IconButton
                      icon={<WebsiteFilledIcon className="size-2.5" />}
                      label={t('builder_canvas_website')}
                      active={isPreviewActive}
                      onClick={() => {
                        if (isCanvasSettingsOpen) {
                          closeCanvasSettings()
                          return
                        }
                        handleViewModeButtonChange(ViewMode.PREVIEW)
                      }}
                      showLabelAlways
                      ghost
                    />

                    <IconButton
                      icon={<CodeIcon className="size-2.5" />}
                      label={t('builder_preview_button_code')}
                      active={viewMode === ViewMode.CODE}
                      disabled={isVersionHistoryOpen}
                      onClick={() => handleViewModeButtonChange(ViewMode.CODE)}
                      showLabelAlways
                      ghost
                    />

                    {isTopLevelDomainEnabled && (
                      <IconButton
                        icon={<WorldIcon className="size-2.5" />}
                        label={t('builder_domain_title')}
                        active={viewMode === ViewMode.DOMAIN}
                        disabled={isVersionHistoryOpen}
                        onClick={() => handleViewModeButtonChange(ViewMode.DOMAIN)}
                        showLabelAlways
                        ghost
                      />
                    )}

                    {isBrandBookEnabled && (
                      <IconButton
                        icon={<ColorPaletteIcon className="size-2.5" />}
                        label="Logo & Brand"
                        active={viewMode === ViewMode.BRAND}
                        disabled={isVersionHistoryOpen}
                        onClick={() => handleViewModeButtonChange(ViewMode.BRAND)}
                        showLabelAlways
                        ghost
                      />
                    )}

                    {isInboxEnabled && inboxBrandId && (
                      <IconButton
                        icon={<ConversationsIcon className="size-2.5" />}
                        label={t('builder_preview_button_inbox')}
                        active={viewMode === ViewMode.INBOX}
                        onClick={() => handleViewModeButtonChange(ViewMode.INBOX)}
                        showLabelAlways
                        ghost
                      />
                    )}

                    {isCanvasEnabled && <CommanderCanvasMenu />}
                  </>
                )}
              </motion.div>
            </Box>

            <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
              {!isCanvasEnabled && (viewMode === ViewMode.PREVIEW || viewMode === ViewMode.EDIT) && (
                <span className="hidden lg:block">
                  <DeviceSelector disabled={isVersionHistoryOpen} />
                </span>
              )}
              <ShareLink />

              {isHelpButtonEnabled && (
                <IconButton
                  data-testid="header-help-button"
                  icon={<HelpIcon className="size-2.5" />}
                  onClick={() => {
                    logClickEvent('develop.header.help', clickContext)();
                    launchSupportChat();
                  }}
                  label={t('builder_preview_button_help')}
                  showLabelWhenActive={false}
                />
              )}

              <ButtonGroup>
                <HeaderUpgradeButton location={LOCATION} />
                <AppPublish location={LOCATION} />
              </ButtonGroup>

              <UserMenu location={LOCATION} />
              <IframeCloseButton location={LOCATION} />
            </Box>
          </Box>
        </div>
      )}

      {isMobile && (
        <div className="px-1.5 py-2.5 md:px-2.5 grow flex justify-end items-center gap-1">
          <ButtonGroup
            value={mobileMode}
            onChange={(value) => {
              handleMobileModeChange(value as MobileMode);
              if (MOBILE_MODE_EID_MAP[value]) logClickEvent(MOBILE_MODE_EID_MAP[value], clickContext)();
            }}
          >
            <ButtonGroup.Item
              value={MobileMode.TOOLS}
              icon={<Apps2Icon className="size-2.5" />}
              label={t('builder_preview_button_tools')}
            />
            <ButtonGroup.Item
              value={MobileMode.PREVIEW}
              icon={<MobilePhoneIcon className="size-2.5" />}
              label={t('builder_canvas_website')}
            />
          </ButtonGroup>
          <UserMenu location={LOCATION} />
          <IframeCloseButton location={LOCATION} />
        </div>
      )}
    </header>
  )
}
