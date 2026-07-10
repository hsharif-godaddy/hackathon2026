'use client'

import { useEffect, useMemo, useRef } from 'react'
import Box from '@ux/box'
import ChatIcon from '@ux/icon/chat'
import GraphIcon from '@ux/icon/graph'
import HistoryIcon from '@ux/icon/history'
import ImageIcon from '@ux/icon/image'
import ShowIcon from '@ux/icon/show'

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup'
import PreviewOverflowSheet, { type PreviewOverflowSheetRef } from '@/app/[market]/develop/components/chat/PreviewOverflowSheet'
import ShareLink from '@/app/[market]/develop/components/layout/ShareLink'
import SettingsMenu, { SettingsMenuRef } from '@/app/[market]/develop/components/settings/SettingsMenu'
import { ChatTab, MobileMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useEditNudgeTooltip } from '@/app/[market]/develop/hooks/useEditNudgeTooltip'
import AppPublish from '@/components/layout/AppPublish'
import { PulseButton } from '@/components/pulse/PulseButton'
import { SWITCHBOARD_APPBUILDER_MEDIA_CANVAS } from '@/config/switchboard-flags'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { isAgentTokenAuthError } from '@/lib/agent-fetch'
import { notifyCommitSelectionFailure } from '@/lib/git-commit-selection-feedback'
import { logger } from '@/lib/request-context'
import { cn } from '@/lib/utils'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { logClickEvent } from '@/utils/instrumentation'

interface ChatToolbarProps {
  className?: string
  onBeforeTabChange?: (tab: ChatTab) => void
  optimisticActiveTab?: ChatTab
  onPreviewRefresh?: () => void
}

const MOBILE_SETTINGS_MENU_TABS = new Set<ChatTab>([
  ChatTab.HISTORY,
  ChatTab.ANALYTICS,
  ChatTab.SETTINGS,
])

export default function ChatToolbar({
    className = '',
    onBeforeTabChange,
    optimisticActiveTab,
    onPreviewRefresh
  }: ChatToolbarProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams()

  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])
  const { activeChatTab, setActiveChatTab } = useChatTabs()

  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const mobileMode = useDevelopPageStore((state) => state.mobileMode);
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges);
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange);
  const toggleMobileInlineEdit = useDevelopPageStore((state) => state.toggleMobileInlineEdit);
  const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId);

  // Use optimistic tab for UI selection state, fall back to URL-based state
  const displayActiveTab = optimisticActiveTab ?? activeChatTab
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const returnToMain = useGitStore((state) => state.returnToMain);
  const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash);
  const isAnalyticsEnabled = useSwitchboard('appbuilder-analytics');
  const isMobileInlineEditEnabled = useSwitchboard('airo-builder-mobile-inline-edit');
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button');
  const isMediaCanvasEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_MEDIA_CANVAS) === true;
  const { dismissForever: dismissEditNudge } = useEditNudgeTooltip();

  const { data: gitHistoryData } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const latestCommitHash = gitHistoryData?.commits?.[0]?.hash || null

  // Track previous values to detect mode changes
  const prevViewModeRef = useRef<ViewMode>(viewMode)
  const prevChatTabRef = useRef<ChatTab>(activeChatTab)
  const settingsMenuRef = useRef<SettingsMenuRef>(null)
  const previewOverflowRef = useRef<PreviewOverflowSheetRef>(null)

  // Auto-return to main branch when:
  useEffect(function autoReturnToMain() {
    const prevViewMode = prevViewModeRef.current
    const prevChatTab = prevChatTabRef.current

    // Update refs for next comparison
    prevViewModeRef.current = viewMode
    prevChatTabRef.current = activeChatTab

    if (!appId || !latestCommitHash) {
      logger.debug('chat_toolbar.auto_return_to_main.skip', {
        reason: !appId ? 'no_app_id' : 'no_latest_commit',
        appId,
        latestCommitHash
      })
      return
    }

    // Detect when mode CHANGES to code editor or history tab closes
    const codeEditorJustOpened = viewMode === ViewMode.CODE && prevViewMode !== ViewMode.CODE
    const historyTabJustClosed = prevChatTab === ChatTab.HISTORY && activeChatTab !== ChatTab.HISTORY

    if (codeEditorJustOpened || historyTabJustClosed) {
      const previousSelectedHash = useGitStore.getState().getSelectedCommitHash(appId)

      // Reset selected commit hash to the latest commit to prevent showing historical commit
      // banner during the async returnToMain operation. This provides smooth UX when switching
      // from History tab to Chat/Preview tab.
      setSelectedCommitHash(appId, latestCommitHash)

      // VersionHistory unmounts on this transition — surface failures via growl and revert
      // the optimistic selection if checkout fails.
      void returnToMain(appId, latestCommitHash).catch(function handleReturnToMainFailure(error: unknown) {
        if (previousSelectedHash && previousSelectedHash !== latestCommitHash) {
          setSelectedCommitHash(appId, previousSelectedHash)
        }
        notifyCommitSelectionFailure(isAgentTokenAuthError(error), t)
      })
    }
  }, [appId, viewMode, activeChatTab, latestCommitHash, returnToMain, setSelectedCommitHash, t])


  const handleTabClick = (tab: ChatTab) => {
    // Call optimistic callback first for instant UI updates
    onBeforeTabChange?.(tab)

    if (tab === ChatTab.SETTINGS) {
      // Open the settings popover instead of navigating
      settingsMenuRef.current?.togglePopover()
      return
    }

    // IMPORTANT: No navigation guard needed for History tab during commit selection.
    // Commit items in the History tab are disabled during publish/restore operations,
    // preventing interaction that could interrupt async checkout. This is intentional
    // design - users can navigate to History but cannot trigger conflicting operations.
    // DO NOT add isSelectingCommit guards here.

    settingsMenuRef.current?.closePopover()
    setActiveChatTab(tab)
  }

  const logTabToolbarClick = (tab: ChatTab) => {
    const tabEid: Partial<Record<ChatTab, string>> = {
      [ChatTab.CHAT]: 'develop.chat_toolbar.chat',
      [ChatTab.MEDIAS]: 'develop.chat_toolbar.media',
      [ChatTab.HISTORY]: 'develop.chat_toolbar.history',
      [ChatTab.ANALYTICS]: 'develop.chat_toolbar.analytics',
      [ChatTab.SETTINGS]: 'develop.chat_toolbar.settings',
    }
    const eid = tabEid[tab]
    if (eid) logClickEvent(eid, clickContext)()
  }

  // Desktop: Always show TOOLS mode
  // Mobile: Show different toolbars based on mobileMode
  const showToolsMode = !isMobile || mobileMode === MobileMode.TOOLS;
  const showPreviewMode = isMobile && mobileMode === MobileMode.PREVIEW;

  // Mobile bottom bar shows only Chat + Media; other tabs live in Settings menu.
  const toolbarGroupValue =
    isMobile && MOBILE_SETTINGS_MENU_TABS.has(displayActiveTab)
      ? ChatTab.SETTINGS
      : displayActiveTab;

  return (
    <div data-testid="chat-toolbar" className="min-w-0 w-full">
      <Box
        orientation="horizontal"
        gap="sm"
        inlineAlignChildren="center"
        blockAlignChildren='spaceBetween'
        className={cn("pt-0 pb-1 md:pb-2 md:pb-0 px-1.5 sm:px-3 md:p-0", className)}
        style={isMobile ? { paddingBottom: `calc(0.25rem + env(safe-area-inset-bottom))` } : undefined}
      >
      {/* TOOLS mode: Chat, Media, and Settings (History/Analytics on desktop only) */}
      {showToolsMode && (
        <>
          <ButtonGroup
            value={toolbarGroupValue}
            onChange={(value) => {
              const tab = value as ChatTab
              logTabToolbarClick(tab)
              handleTabClick(tab)
            }}
          >
            <ButtonGroup.Item
              value={ChatTab.CHAT}
              icon={<ChatIcon className="size-2.5 rtl:scale-x-[-1]" />}
              label={t('builder_chat_toolbar_button_chat')}
              data-testid="chat-toolbar-tab-chat"
            />
            {!isMediaCanvasEnabled && (
              <ButtonGroup.Item
                value={ChatTab.MEDIAS}
                icon={<ImageIcon />}
                label={t('builder_chat_toolbar_button_media')}
                data-testid="chat-toolbar-tab-media"
              />
            )}
            {!isMobile && (
              <>
                <ButtonGroup.Item
                  value={ChatTab.HISTORY}
                  icon={<HistoryIcon className="size-2.5" />}
                  label={t('builder_chat_toolbar_button_history')}
                  data-testid="chat-toolbar-history-tab"
                />
                {isAnalyticsEnabled && (
                  <ButtonGroup.Item
                    value={ChatTab.ANALYTICS}
                    icon={<GraphIcon className="size-2.5 rtl:scale-x-[-1]" />}
                    label={t('builder_settings_nav_analytics')}
                    data-testid="chat-toolbar-analytics-tab"
                  />
                )}
              </>
            )}
            <SettingsMenu ref={settingsMenuRef} />
          </ButtonGroup>

          {!isMobile && <PulseButton />}

          {isMobile && (
            <Box orientation="horizontal" gap="sm">
              <ShareLink location="develop.chat_toolbar" />
              <AppPublish location="develop.chat_toolbar" />
            </Box>
          )}
        </>
      )}

      {/* PREVIEW mode (mobile): [View] [⋮] ... [Share] [Publish] */}
      {showPreviewMode && (
        <>
          <ButtonGroup
            value={viewMode}
            onChange={(value) => {
              if (value === 'preview-actions') {
                previewOverflowRef.current?.toggle()
                return
              }
              handleViewModeChange(value as ViewMode, hasUnsavedChanges)
              logClickEvent('develop.chat_toolbar.view', clickContext)()
            }}
          >
            <ButtonGroup.Item
              value={ViewMode.PREVIEW}
              icon={<ShowIcon className="size-2.5" />}
              label={t('builder_chat_toolbar_button_view')}
            />
            <PreviewOverflowSheet
              ref={previewOverflowRef}
              showEdit={isMobileInlineEditEnabled}
              onEdit={() => {
                logClickEvent('develop.chat_toolbar.inline_edit', clickContext)()
                dismissEditNudge()
                toggleMobileInlineEdit()
              }}
              onRefresh={onPreviewRefresh ? () => {
                logClickEvent('develop.chat_toolbar.refresh', clickContext)()
                onPreviewRefresh()
              } : undefined}
              showInbox={isInboxEnabled === true && !!inboxBrandId}
              onInbox={() => {
                logClickEvent('develop.chat_toolbar.inbox', clickContext)()
                handleViewModeChange(ViewMode.INBOX, hasUnsavedChanges)
              }}
            />
          </ButtonGroup>

          <Box orientation="horizontal" gap="sm">
            <ShareLink location="develop.chat_toolbar" />
            <AppPublish location="develop.chat_toolbar" />
          </Box>
        </>
      )}
    </Box>
    </div>
  )
}
