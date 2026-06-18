'use client';

import clsx from 'clsx';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import Box from '@ux/box';
import Growl from '@ux/growl';
import Apps2Icon from '@ux/icon/apps2'
import CodeIcon from '@ux/icon/code'
import ColorPaletteIcon from '@ux/icon/color-palette'
import ConversationsIcon from '@ux/icon/conversations'
import InlineEditIcon from '@ux/icon/inline-edit'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WorldIcon from '@ux/icon/world'
import Tag from '@ux/tag';

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup';
import { MOBILE_MODE_EID_MAP, VIEW_MODE_EID_MAP } from '@/app/[market]/develop/components/headerEids';
import IconButton from '@/app/[market]/develop/components/IconButton';
import ShareLink from '@/app/[market]/develop/components/layout/ShareLink';
import { useIsDesignKitWizardProfile } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import DeviceSelector from '@/app/[market]/develop/components/preview/DeviceSelector'
import { MobileMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useInboxUnresolvedCount } from '@/app/[market]/develop/hooks/useInbox'
import { RedoIcon, UndoIcon } from '@/components/icons/UndoRedoIcons';
import { AiroLogo } from '@/components/layout/AiroLogo';
import AppPublish from '@/components/layout/AppPublish';
import HeaderUpgradeButton from '@/components/layout/HeaderUpgradeButton';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import UserMenu from '@/components/layout/UserMenu';
import { useHeadUndoAction } from '@/hooks/useHeadUndoAction';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { usePublishUpsellEligibility } from '@/hooks/usePublishUpsellEligibility';
import { useRedoAction } from '@/hooks/useRedoAction';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation'

// Tailwind fragment for the Preview/Edit toggle.
// Transparent inactive state lets the rail bg show through so the pill reads as one toggle.
const PREVIEW_EDIT_TOGGLE_INACTIVE_TRANSPARENT = '[&[aria-checked=false]]:!bg-transparent';

// Edit-mode awareness cue (appbuilder-edit-mode-cue): tint the active Edit pill with the
// feedbackInfo accent so "I'm in Edit mode" reads from the toggle's color, not just its label.
const PREVIEW_EDIT_TOGGLE_EDIT_ACTIVE_ACCENT =
  '[&[aria-checked=true]]:!bg-intents-ux-feedbackHighContrastInfo-feedbackColor [&[aria-checked=true]]:!text-intents-ux-feedbackHighContrastInfo-onFeedbackColor';

interface DevelopHeaderProps {
  onPreviewRefresh: () => void;
}

export default function DevelopHeader({ onPreviewRefresh }: DevelopHeaderProps) {
  const t = useTranslations();
  const isEditModeCueEnabled = useSwitchboard('appbuilder-edit-mode-cue') === true;
  const isBrandBookEnabled = useSwitchboard('appbuilder-brandbook');
  // The design-kit wizard renders inside the "Logo & Brand" tab, so the tab must be
  // visible whenever the wizard profile is active (gated on the appbuilder-agent-profile
  // switchboard value), even if the generic brandbook flag is off.
  const showDesignKitWizard = useIsDesignKitWizardProfile();
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button');
  const location = 'develop';
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const { isTreatment } = usePublishUpsellEligibility();

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
  const handleMobileModeChange = useDevelopPageStore((state) => state.handleMobileModeChange)
  const toggleChatPaneCollapse = useDevelopPageStore((state) => state.toggleChatPaneCollapse)

  const handleViewModeButtonChange = (value: string) => {
    if (value === ViewMode.CODE) {
      void checkAndShowPaywall(async () => {
        handleViewModeChange(value as ViewMode, hasUnsavedChanges)
        if (VIEW_MODE_EID_MAP[value]) logClickEvent(VIEW_MODE_EID_MAP[value], clickContext)()
      })
      return
    }
    handleViewModeChange(value as ViewMode, hasUnsavedChanges)
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
                />
                <ButtonGroup.Item
                  value={ViewMode.EDIT}
                  icon={<InlineEditIcon className="size-2.5" />}
                  label={t('builder_preview_button_edit')}
                  className={clsx(
                    PREVIEW_EDIT_TOGGLE_INACTIVE_TRANSPARENT,
                    isEditModeCueEnabled && PREVIEW_EDIT_TOGGLE_EDIT_ACTIVE_ACCENT,
                  )}
                  disabled={isVersionHistoryOpen}
                />
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
                />
                {isTopLevelDomainEnabled && (
                  <ButtonGroup.Item
                    value={ViewMode.DOMAIN}
                    icon={<WorldIcon className="size-2.5" />}
                    label={t('builder_domain_title')}
                    disabled={isVersionHistoryOpen}
                  />
                )}
                {(isBrandBookEnabled || showDesignKitWizard) && (
                  <ButtonGroup.Item
                    value={ViewMode.BRAND}
                    icon={<ColorPaletteIcon className="size-2.5" />}
                    label="Logo & Brand"
                    disabled={isVersionHistoryOpen}
                  />
                )}
                {isInboxEnabled && inboxBrandId && (
                  <ButtonGroup.Item
                    value={ViewMode.INBOX}
                    icon={<ConversationsIcon className="size-2.5" />}
                    label={t('builder_preview_button_inbox')}
                    cornerBadge={
                      inboxUnresolvedCount > 0 ? <span className="size-1 shrink-0 rounded-full bg-intents-ux-feedbackHighContrastCritical-feedbackColor" /> : undefined
                    }
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
              label={t('builder_preview_button_preview')}
            />
          </ButtonGroup>
          {isTreatment && <AppPublish location="develop" />}
          <UserMenu location="develop" />
          <IframeCloseButton location="develop" />
        </div>
      )}
      {paywallModal}
    </header>
  )
}
