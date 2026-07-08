'use client';

import clsx from 'clsx';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import Box from '@ux/box';
import Growl from '@ux/growl';
import ChatIcon from '@ux/icon/chat'
import CodeIcon from '@ux/icon/code'
import ColorPaletteIcon from '@ux/icon/color-palette'
import ConversationsIcon from '@ux/icon/conversations'
import ImageIcon from '@ux/icon/image'
import InlineEditIcon from '@ux/icon/inline-edit'
import MegaphoneIcon from '@ux/icon/megaphone'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import SparklesIcon from '@ux/icon/sparkles'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WorldIcon from '@ux/icon/world'
import Tag from '@ux/tag';

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup';
import { EditNudgeTooltip } from '@/app/[market]/develop/components/EditNudgeTooltip';
import { MOBILE_MODE_EID_MAP, VIEW_MODE_EID_MAP } from '@/app/[market]/develop/components/headerEids';
import IconButton from '@/app/[market]/develop/components/IconButton';
import { InboxUnresolvedBadge } from '@/app/[market]/develop/components/layout/InboxUnresolvedBadge';
import ShareAccess, { ShareAccessButton } from '@/app/[market]/develop/components/layout/ShareAccess';
import ShareLink from '@/app/[market]/develop/components/layout/ShareLink';
import DeviceSelector from '@/app/[market]/develop/components/preview/DeviceSelector'
import { PreviewNudgeTooltip } from '@/app/[market]/develop/components/PreviewNudgeTooltip';
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy';
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign';
import { MobileMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useEditNudgeTooltip } from '@/app/[market]/develop/hooks/useEditNudgeTooltip'
import { useInboxUnresolvedCount } from '@/app/[market]/develop/hooks/useInbox'
import { RedoIcon, UndoIcon } from '@/components/icons/UndoRedoIcons';
import { AiroLogo } from '@/components/layout/AiroLogo';
import AppPublish from '@/components/layout/AppPublish';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import UserMenu from '@/components/layout/UserMenu';
import { SWITCHBOARD_APPBUILDER_MEDIA_CANVAS } from '@/config/switchboard-flags';
import { useHeadUndoAction } from '@/hooks/useHeadUndoAction';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { useRedoAction } from '@/hooks/useRedoAction';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation'

// Tailwind fragment for the Preview/Edit toggle.
// Transparent inactive state lets the rail bg show through so the pill reads as one toggle.
const PREVIEW_EDIT_TOGGLE_INACTIVE_TRANSPARENT = '[&[aria-checked=false]]:!bg-transparent';

// Edit-mode awareness cue (appbuilder-edit-mode-cue): tint the active Edit pill with Airo
// Proud Purple 200 so "I'm in Edit mode" reads from the toggle's color, not just its label.
const PREVIEW_EDIT_TOGGLE_EDIT_ACTIVE_ACCENT =
  '[&[aria-checked=true]]:!bg-light-purple-solid [&[aria-checked=true]]:!text-ai-dark';

interface DevelopHeaderProps {
  onPreviewRefresh: () => void;
  showPreviewNudgeTooltip?: boolean;
  onDismissPreviewNudge?: () => void;
}

export default function DevelopHeader({
  onPreviewRefresh,
  showPreviewNudgeTooltip,
  onDismissPreviewNudge,
}: DevelopHeaderProps) {
  const t = useTranslations();
  const isEditModeCueEnabled = useSwitchboard('appbuilder-edit-mode-cue') === true;
  const editButtonRef = useRef<HTMLDivElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const { visible: editNudgeVisible, dismissForever: dismissEditNudge } = useEditNudgeTooltip();
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button');
  const isAutomationsEnabled = useSwitchboard('appbuilder-automations');
  const isMarketingCampaignsEnabled = useSwitchboard('appbuilder-marketing-campaigns') === true;
  const isMediaCanvasEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_MEDIA_CANVAS) === true;
  const location = 'develop';
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const { checkAndShowPaywall, paywallModal, isPaywallLoading } = usePaywallModal({
    appId,
    source: 'code_editor',
    itc: PAYWALL_ITC.CODE_EDITOR,
  });

  const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId)
  const { data: inboxUnresolvedCount = 0 } = useInboxUnresolvedCount(
    isInboxEnabled && inboxBrandId ? inboxBrandId : undefined,
  )
  const chatPaneWidth = useDevelopPageStore((state) => state.chatPaneWidth)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const { openList: openMarketingList } = useOpenMarketingCampaign()
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange)
  const toggleChatPaneCollapse = useDevelopPageStore((state) => state.toggleChatPaneCollapse)

  const handleViewModeButtonChange = (value: string) => {
    if (value === ViewMode.MARKETING) {
      openMarketingList()
      if (VIEW_MODE_EID_MAP[value]) logClickEvent(VIEW_MODE_EID_MAP[value], clickContext)()
      return
    }
    if (value === ViewMode.CODE) {
      void checkAndShowPaywall(async () => {
        handleViewModeChange(value as ViewMode, hasUnsavedChanges)
        if (VIEW_MODE_EID_MAP[value]) logClickEvent(VIEW_MODE_EID_MAP[value], clickContext)()
      })
      return
    }
    handleViewModeChange(value as ViewMode, hasUnsavedChanges)
    if (value === ViewMode.EDIT) dismissEditNudge()
    if (VIEW_MODE_EID_MAP[value]) logClickEvent(VIEW_MODE_EID_MAP[value], clickContext)()
  }

  const undoAction = useHeadUndoAction()
  const redoAction = useRedoAction()

  // Header has no transcript feedback for restore failures — surface via growl.
  useEffect(function showUndoErrorGrowl() {
    if (!undoAction.error) return
    Growl.addGrowlMessage({
      id: 'header-undo-failed',
      title: t('builder_chat_undo_restore_failed', undefined, 'Could not undo. Please try again or send a new message.'),
      emphasis: 'critical',
      lifetime: 3000,
    })
    undoAction.clearError()
  }, [undoAction, t])

  useEffect(function showRedoErrorGrowl() {
    if (!redoAction.error) return
    Growl.addGrowlMessage({
      id: 'header-redo-failed',
      title: t('builder_chat_redo_restore_failed', undefined, 'Could not redo. Please try again or send a new message.'),
      emphasis: 'critical',
      lifetime: 3000,
    })
    redoAction.clearError()
  }, [redoAction, t])

  const logoBlock = (
    <div className="flex items-center gap-1" data-partial="componentAiro">
      <Link
        href="/"
        className="flex items-center"
        onClick={() => logClickEvent(`${location}.header.airo_ai_link`, clickContext)()}
      >
        <AiroLogo className="relative" />
      </Link>
      <Tag emphasis="highlight" highcontrast>{t('builder_beta')}</Tag>
    </div>
  );

  return (
    <header data-testid="airo-header" className="flex">
      <motion.div
        className="shrink-0 flex items-center gap-1.5 p-1.5 md:ps-2.5 md:pe-0"
        animate={{
          width: (isChatPaneCollapsed || isMobile) ? 'auto' : `${chatPaneWidth}px`,
          justifyContent: isChatPaneCollapsed ? 'flex-start' : 'space-between'
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30
        }}
      >
        {logoBlock}
        {!isMobile && (
          <motion.div layout>
            <IconButton
              icon={isChatPaneCollapsed ? <SidebarExpandIcon className="size-2.5 rtl:scale-x-[-1]" /> : <SidebarCollapseIcon className="size-2.5 rtl:scale-x-[-1]" />}
              onClick={() => {
                toggleChatPaneCollapse();
                logClickEvent(`develop.header.chat_pane_${isChatPaneCollapsed ? 'expand' : 'collapse'}`, clickContext)();
              }}
              label={isChatPaneCollapsed ? t('builder_preview_button_expand') : t('builder_preview_button_collapse')}
              showLabelWhenActive={false}
            />
          </motion.div>
        )}
      </motion.div>

      {/* Larger screen header */}
      {!isMobile && (
        <div className="p-1.5 md:p-2.5 grow overflow-hidden">
          <Box
            orientation="horizontal"
            blockAlignChildren='spaceBetween'
            inlineAlignChildren='center'
            gap="sm"
            className="overflow-x-auto"
          >
            {/* Left side controls */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren='center' className="shrink-0">
              {/* Primary mode toggle: segmented Preview ↔ Edit. */}
              <ButtonGroup
                value={viewMode}
                onChange={handleViewModeButtonChange}
              >
                <ButtonGroup.Item
                  value={ViewMode.PREVIEW}
                  icon={<WebsiteFilledIcon className="size-2.5" />}
                  label={t('builder_preview_button_preview')}
                  className={PREVIEW_EDIT_TOGGLE_INACTIVE_TRANSPARENT}
                  data-testid="header-tab-preview"
                />
                <div ref={editButtonRef} className="relative inline-flex">
                  <ButtonGroup.Item
                    value={ViewMode.EDIT}
                    icon={<InlineEditIcon className="size-2.5" />}
                    label={t('builder_preview_button_edit')}
                    className={clsx(
                      PREVIEW_EDIT_TOGGLE_INACTIVE_TRANSPARENT,
                      isEditModeCueEnabled && PREVIEW_EDIT_TOGGLE_EDIT_ACTIVE_ACCENT,
                    )}
                    disabled={isVersionHistoryOpen}
                    data-testid="header-tab-edit"
                  />
                  {isEditModeCueEnabled && editNudgeVisible && (
                    <EditNudgeTooltip anchorRef={editButtonRef} placement="bottom" />
                  )}
                </div>
              </ButtonGroup>

              {/* Secondary tools: Code, Domain, Brand, Inbox. */}
              <ButtonGroup
                value={viewMode}
                onChange={handleViewModeButtonChange}
                role="group"
              >
                <ButtonGroup.Item
                  value={ViewMode.CODE}
                  icon={<CodeIcon className="size-2.5" />}
                  label={t('builder_preview_button_code')}
                  disabled={isVersionHistoryOpen || isPaywallLoading}
                  data-testid="header-tab-code"
                />
                {isTopLevelDomainEnabled && (
                  <ButtonGroup.Item
                    value={ViewMode.DOMAIN}
                    icon={<WorldIcon className="size-2.5" />}
                    label={t('builder_domain_title')}
                    disabled={isVersionHistoryOpen}
                    data-testid="develop-view-domain"
                  />
                )}
                <ButtonGroup.Item
                  value={ViewMode.BRAND}
                  icon={<ColorPaletteIcon className="size-2.5" />}
                  label={t('builder_canvas_brand')}
                  disabled={isVersionHistoryOpen}
                  data-testid="header-tab-brand"
                />
                {isMediaCanvasEnabled && (
                  <ButtonGroup.Item
                    value={ViewMode.MEDIA}
                    icon={<ImageIcon className="size-2.5" />}
                    label="Media"
                    disabled={isVersionHistoryOpen}
                  />
                )}
                {isInboxEnabled && inboxBrandId && (
                  <ButtonGroup.Item
                    value={ViewMode.INBOX}
                    icon={<ConversationsIcon className="size-2.5" />}
                    label={t('builder_preview_button_inbox')}
                    cornerBadge={
                      inboxUnresolvedCount > 0 ? <InboxUnresolvedBadge count={inboxUnresolvedCount} /> : undefined
                    }
                  />
                )}
                {isAutomationsEnabled && (
                  <ButtonGroup.Item
                    value={ViewMode.AUTOMATIONS}
                    icon={<SparklesIcon className="size-2.5" />}
                    label={t('builder_header_button_automations', undefined, 'Automations')}
                  />
                )}
                {isMarketingCampaignsEnabled && (
                  <ButtonGroup.Item
                    value={ViewMode.MARKETING}
                    icon={<MegaphoneIcon className="size-2.5" />}
                    label={translateCampaignKey(t, CAMPAIGN_KEYS.marketingTab)}
                    disabled={isVersionHistoryOpen}
                  />
                )}
              </ButtonGroup>
            </Box>

            <Box orientation="horizontal" gap="sm" inlineAlignChildren='center'>
              {viewMode === ViewMode.EDIT && (
                <>
                  <IconButton
                    data-testid="header-undo-button"
                    icon={<UndoIcon className="size-2.5" />}
                    disabled={undoAction.isLocked || undoAction.isPending || isVersionHistoryOpen}
                    onClick={undoAction.triggerUndo}
                    label={t('builder_header_undo', undefined, 'Undo')}
                    showLabelWhenActive={false}
                  />
                  <IconButton
                    data-testid="header-redo-button"
                    icon={<RedoIcon className="size-2.5" />}
                    disabled={redoAction.isLocked || redoAction.isPending || isVersionHistoryOpen}
                    onClick={redoAction.triggerRedo}
                    label={t('builder_header_redo', undefined, 'Redo')}
                    showLabelWhenActive={false}
                  />
                </>
              )}
              {(viewMode === ViewMode.PREVIEW || viewMode === ViewMode.EDIT) && (
                <>
                  <IconButton
                    data-testid="header-refresh-button"
                    icon={<RefreshIcon className="size-2.5" />}
                    disabled={isVersionHistoryOpen}
                    onClick={() => {
                      onPreviewRefresh();
                      logClickEvent('develop.header.refresh', clickContext)();
                    }}
                    label={t('builder_preview_button_refresh')}
                    showLabelWhenActive={false}
                  />

                  <span className="hidden lg:block">
                    <DeviceSelector disabled={isVersionHistoryOpen} />
                  </span>
                </>
              )}
              <ShareLink />
              <ShareAccessButton />

              {/* Always show Upgrade/Publish/UserMenu */}
              <ButtonGroup>
                <HeaderUpgradeButton location="develop" />
                <AppPublish location="develop" />
              </ButtonGroup>

              <UserMenu location="develop" />
              <IframeCloseButton location="develop" />
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
              if (value === MobileMode.PREVIEW) onDismissPreviewNudge?.();
              handleMobileModeChange(value as MobileMode);
              if (MOBILE_MODE_EID_MAP[value]) logClickEvent(MOBILE_MODE_EID_MAP[value], clickContext)();
            }}
          >
            <ButtonGroup.Item
              value={MobileMode.TOOLS}
              icon={<ChatIcon className="size-2.5 rtl:scale-x-[-1]" />}
              label={t('builder_chat_toolbar_button_chat')}
            />
            <ButtonGroup.Item
              ref={previewButtonRef}
              value={MobileMode.PREVIEW}
              icon={<MobilePhoneIcon className="size-2.5" />}
              label={t('builder_preview_button_preview')}
            />
          </ButtonGroup>
          <PreviewNudgeTooltip
            anchorRef={previewButtonRef}
            visible={Boolean(showPreviewNudgeTooltip)}
          />
          <UserMenu location="develop" />
          <IframeCloseButton location="develop" />
        </div>
      )}
      {paywallModal}
      <ShareAccess />
    </header>
  )
}
