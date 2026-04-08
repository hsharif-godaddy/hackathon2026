'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useCallback } from 'react';
import Box from '@ux/box';
import Apps2Icon from '@ux/icon/apps2'
import CodeIcon from '@ux/icon/code'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import WandIcon from '@ux/icon/wand'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WorldIcon from '@ux/icon/world'
import Tag from '@ux/tag';

import { ButtonGroup } from '@/app/develop/components/ButtonGroup';
import IconButton from '@/app/develop/components/IconButton';
import DomainMenu from '@/app/develop/components/layout/DomainMenu';
import DeviceSelector from '@/app/develop/components/preview/DeviceSelector'
import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/develop/components/types'
import { AiroLogo } from '@/components/layout/AiroLogo';
import AppPublish from '@/components/layout/AppPublish';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import UserMenu from '@/components/layout/UserMenu';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { generateClickEID } from '@/utils/instrumentation'

interface DevelopHeaderProps {
  onPreviewRefresh: () => void;
}

export default function DevelopHeader({ onPreviewRefresh }: DevelopHeaderProps) {
  const t = useTranslations();
  const location = 'develop';

  const { activeChatTab } = useChatTabs()
  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange)
  const toggleChatPaneCollapse = useDevelopPageStore((state) => state.toggleChatPaneCollapse)
  const { setActiveChatTab, setActiveSettingsSection } = useChatTabs();

  const handleDomainSettings = useCallback(() => {
    setActiveSettingsSection(SettingsSection.DOMAIN);
    setActiveChatTab(ChatTab.SETTINGS);
  }, [setActiveSettingsSection]);

  return (
    <header data-testid="airo-header" className="flex">
      <motion.div
        className="p-1.5 md:pl-2.5 md:pr-0 shrink-0 flex items-center gap-1.5"
        animate={{
          width: (isChatPaneCollapsed || isMobile) ? undefined : `${chatPaneWidth}px`,
          justifyContent: isChatPaneCollapsed ? 'flex-start' : 'space-between'
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30
        }}
      >
        <div className="flex items-center gap-1" data-partial="componentAiro">
          <Link
            href="/"
            className="flex items-center"
            data-eid={ generateClickEID(`${location}.header.airo_ai_link`) }
          >
            <AiroLogo className="relative" />
          </Link>
          <Tag emphasis="highlight" highcontrast>{t('builder_beta')}</Tag>
        </div>
        {!isMobile && (
          <motion.div layout>
            <IconButton
              icon={isChatPaneCollapsed ? <SidebarExpandIcon className="size-2.5" /> : <SidebarCollapseIcon className="size-2.5" />}
              onClick={toggleChatPaneCollapse}
              label={isChatPaneCollapsed ? t('builder_preview_button_expand') : t('builder_preview_button_collapse')}
              showLabelWhenActive={false}
              data-eid={generateClickEID(`develop.header.chat_pane_${isChatPaneCollapsed ? 'expand' : 'collapse'}`)}
            />
          </motion.div>
        )}
      </motion.div>

      {/* Larger screen header */}
      {!isMobile && (
        <div className="p-1.5 md:p-2.5 grow">
          <Box
            orientation="horizontal"
            blockAlignChildren={activeChatTab === ChatTab.SETTINGS ? 'end' : 'spaceBetween'}
            inlineAlignChildren='center'
            gap="sm"
          >
            {/* Left side controls - hide on Settings tab */}
            {activeChatTab !== ChatTab.SETTINGS && (
              <Box orientation="horizontal" gap="sm" inlineAlignChildren='center'>
                <ButtonGroup
                  value={viewMode}
                  onChange={(value) => {
                    handleViewModeChange(value as ViewMode, hasUnsavedChanges);
                  }}
                  data-eid={generateClickEID('develop.header.view_mode')}
                >
                  <ButtonGroup.Item
                    value={ViewMode.PREVIEW}
                    icon={<WebsiteFilledIcon className="size-2.5" />}
                    label={t('builder_preview_button_preview')}
                    showLabelAlways
                    data-eid={generateClickEID('develop.header.iframe')}
                  />
                  <ButtonGroup.Item
                    value={ViewMode.EDIT}
                    icon={<WandIcon className="size-2.5" />}
                    label={t('builder_preview_button_edit')}
                    showLabelAlways
                    data-eid={generateClickEID('develop.header.edit_mode')}
                  />
                  <ButtonGroup.Item
                    value={ViewMode.CODE}
                    icon={<CodeIcon className="size-2.5" />}
                    label={t('builder_preview_button_code')}
                    showLabelAlways
                    disabled={isVersionHistoryOpen}
                    data-eid={generateClickEID('develop.header.code_editor')}
                  />
                </ButtonGroup>
              </Box>
            )}

            <Box orientation="horizontal" gap="sm" inlineAlignChildren='center'>
              {/* Middle controls - hide on Settings tab */}
              {activeChatTab !== ChatTab.SETTINGS && (
                <>
                  <IconButton
                    icon={<RefreshIcon className="size-2.5" />}
                    disabled={viewMode === ViewMode.CODE || isVersionHistoryOpen}
                    onClick={onPreviewRefresh}
                    data-eid={generateClickEID('develop.header.refresh')}
                    label={t('builder_preview_button_refresh')}
                    showLabelWhenActive={false}
                  />

                  <span className="hidden lg:block">
                    <DeviceSelector disabled={viewMode === ViewMode.CODE} />
                  </span>

                  <DomainMenu />

                  <IconButton
                    icon={<WorldIcon className="size-2.5" />}
                    label={t('builder_project_domain_title')}
                    showLabelWhenActive={false}
                    data-eid={generateClickEID('develop.header.domain_settings')}
                    onClick={handleDomainSettings}
                  />
                </>
              )}

              {/* Always show Upgrade/Publish/UserMenu */}
              <ButtonGroup>
                <HeaderUpgradeButton location="develop" />
                <AppPublish location="develop" />
              </ButtonGroup>

              <UserMenu location="develop" />
            </Box>
          </Box>
        </div>
      )}

      {/* Mobile header */}
      {isMobile && (
        <div className="px-1.5 py-2.5 md:px-2.5 grow flex justify-end items-center gap-1">
          <ButtonGroup
            value={mobileMode}
            onChange={(value) => {
              handleMobileModeChange(value as MobileMode);
            }}
            data-eid={generateClickEID('develop.mobile_header.view_mode')}
          >
            <ButtonGroup.Item
              value={MobileMode.TOOLS}
              icon={<Apps2Icon className="size-2.5" />}
              label={t('builder_preview_button_tools')}
              showLabelAlways
              data-eid={generateClickEID('develop.mobile_header.tools')}
            />
            <ButtonGroup.Item
              value={MobileMode.PREVIEW}
              icon={<MobilePhoneIcon className="size-2.5" />}
              label={t('builder_preview_button_preview')}
              showLabelAlways
              data-eid={generateClickEID('develop.mobile_header.preview')}
            />
          </ButtonGroup>
          <UserMenu location="develop" />
        </div>
      )}
    </header>
  )
}
