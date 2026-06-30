'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import Box from '@ux/box';
import CodeIcon from '@ux/icon/code'
import ColorPaletteIcon from '@ux/icon/color-palette'
import ConversationsIcon from '@ux/icon/conversations'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WorldIcon from '@ux/icon/world'

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup';
import { VIEW_MODE_EID_MAP } from '@/app/[market]/develop/components/headerEids';
import IconButton from '@/app/[market]/develop/components/IconButton';
import ShareLink from '@/app/[market]/develop/components/layout/ShareLink';
import DeviceSelector from '@/app/[market]/develop/components/preview/DeviceSelector'
import { ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import AppPublish from '@/components/layout/AppPublish';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import UserMenu from '@/components/layout/UserMenu';
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
import { CommanderLogo } from './CommanderLogo'
import { CanvasTabs } from '../canvas/CanvasTabs'
import { CommanderPosition } from '../types'

const LOCATION = 'develop';

export default function CommanderHeader() {
  const t = useTranslations();
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button');
  const isCanvasEnabled = useCommanderCanvasEnabled();
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled();
  const isCanvasSettingsOpen = useCommanderStore((state) => state.isCanvasSettingsOpen);
  const closeCanvasSettings = useCommanderStore((state) => state.closeCanvasSettings);
  const isLeftDock = useEffectiveCommanderPosition() === CommanderPosition.LeftDock
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);

  const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)

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
        <AnimatePresence initial={false}>
          {!isLeftDock && (
            <motion.div
              key="commander-header-logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="p-1.5 md:ps-2.5 md:pe-0"
            >
              <CommanderLogo appId={appId} source="header" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

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

                  <IconButton
                    icon={<ColorPaletteIcon className="size-2.5" />}
                    label={t('builder_canvas_brand')}
                    active={viewMode === ViewMode.BRAND}
                    disabled={isVersionHistoryOpen}
                    onClick={() => handleViewModeButtonChange(ViewMode.BRAND)}
                    showLabelAlways
                    ghost
                  />

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

            <ButtonGroup>
              <HeaderUpgradeButton location={LOCATION} />
              <AppPublish location={LOCATION} />
            </ButtonGroup>

            <UserMenu location={LOCATION} />
            <IframeCloseButton location={LOCATION} />
          </Box>
        </Box>
      </div>
    </header>
  )
}
