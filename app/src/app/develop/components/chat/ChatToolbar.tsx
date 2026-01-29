'use client'

import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import CommentsIcon from '@ux/icon/comments'
import HistoryIcon from '@ux/icon/history'
import SettingsIcon from '@ux/icon/settings'
import WebsiteIcon from '@ux/icon/website'

import IconButton from '@/app/develop/components/IconButton'
import SettingsMenu from '@/app/develop/components/settings/SettingsMenu'
import { ChatTab, ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { cn } from '@/lib/utils'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { generateClickEID } from '@/utils/instrumentation'

interface ChatToolbarProps {
  isProcessing?: boolean
  className?: string
  onBeforeTabChange?: (tab: ChatTab) => void
  optimisticActiveTab?: ChatTab
  hasPreviewUpdate?: boolean
}

export default function ChatToolbar({
    isProcessing = false,
    className = '',
    onBeforeTabChange,
    optimisticActiveTab,
    hasPreviewUpdate = false
  }: ChatToolbarProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams()
  const { activeChatTab, setActiveChatTab, activeSettingsSection, setActiveSettingsSection } = useChatTabs()
  const isMobile = useDevelopPageStore((state) => state.isMobile);

  // Use optimistic tab for UI selection state, fall back to URL-based state
  const displayActiveTab = optimisticActiveTab ?? activeChatTab
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen);
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode);
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit);
  const returnToMain = useGitStore((state) => state.returnToMain);

  const { data: isSettingsEnabled } = useSwitchboard('appbuilder-settings');

  const { data: gitHistoryData, isFetching: isFetchingCommits } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const latestCommitHash = gitHistoryData?.commits?.[0]?.hash || null

  // Track previous values to detect mode changes
  const prevViewModeRef = useRef<ViewMode>(viewMode)
  const prevSelectModeRef = useRef<boolean>(isSelectMode)
  const prevChatTabRef = useRef<ChatTab>(activeChatTab)

  // Auto-return to main branch when:
  useEffect(function autoReturnToMain() {
    const prevViewMode = prevViewModeRef.current
    const prevSelectMode = prevSelectModeRef.current
    const prevChatTab = prevChatTabRef.current

    // Update refs for next comparison
    prevViewModeRef.current = viewMode
    prevSelectModeRef.current = isSelectMode
    prevChatTabRef.current = activeChatTab

    if (!appId || !latestCommitHash) {
      logger.debug('chat_toolbar.auto_return_to_main.skip', {
        reason: !appId ? 'no_app_id' : 'no_latest_commit',
        appId,
        latestCommitHash
      })
      return
    }

    // Detect when mode CHANGES to code editor or select mode
    const codeEditorJustOpened = viewMode === ViewMode.CODE && prevViewMode !== ViewMode.CODE
    const selectModeJustActivated = isSelectMode && !prevSelectMode
    const historyTabJustClosed = prevChatTab === ChatTab.HISTORY && activeChatTab !== ChatTab.HISTORY

    if (codeEditorJustOpened || selectModeJustActivated || historyTabJustClosed) {
      returnToMain(appId, latestCommitHash)
    }
  }, [appId, viewMode, isSelectMode, activeChatTab, latestCommitHash, returnToMain])


  const handleTabClick = (tab: ChatTab) => {
    // Call optimistic callback first for instant UI updates
    onBeforeTabChange?.(tab)

    if (tab === ChatTab.SETTINGS) {
      // Preserve or initialize settings section when opening the settings tab
      setActiveSettingsSection(activeSettingsSection)
      return
    }

    // This will update the URL, but the optimistic state is already updated above
    setActiveChatTab(tab)
  }

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      className={cn("pt-0 pb-2 md:pb-0 px-2 sm:px-3 md:p-0", className)}
      style={isMobile ? { paddingBottom: `calc(0.5rem + env(safe-area-inset-bottom))` } : undefined}
    >
      {isMobile && (
        <div className="relative">
          <IconButton
            icon={<WebsiteIcon />}
            dataEid={generateClickEID('develop.chat_toolbar.preview')}
            onClick={() => handleTabClick(ChatTab.PREVIEW)}
            label={t('builder_chat_toolbar_button_preview')}
            active={displayActiveTab === ChatTab.PREVIEW}
          />
          {hasPreviewUpdate && (
            <span className="absolute top-0 right-0 flex h-1.5 w-1.5 pointer-events-none">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ai opacity-50"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-ai"></span>
            </span>
          )}
        </div>
      )}
      <IconButton
        icon={<CommentsIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.chat')}
        onClick={() => handleTabClick(ChatTab.CHAT)}
        label={t('builder_chat_toolbar_button_chat')}
        active={displayActiveTab === ChatTab.CHAT}
        showLabelAlways={!isMobile}
      />
      <IconButton
        icon={<HistoryIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.history')}
        onClick={() => handleTabClick(ChatTab.HISTORY)}
        label={t('builder_chat_toolbar_button_history')}
        active={displayActiveTab === ChatTab.HISTORY}
        disabled={isProcessing || isFetchingCommits || isSelectingCommit || viewMode === ViewMode.CODE || isSelectMode}
        showLabelAlways={!isMobile}
      />
      {isMobile ? (
        isSettingsEnabled && <SettingsMenu />
      ) : (
        <IconButton
          id="tour-settings-button"
          icon={<SettingsIcon />}
          dataEid={generateClickEID('develop.chat_toolbar.settings')}
          onClick={isSettingsEnabled ? () => handleTabClick(ChatTab.SETTINGS) : undefined}
          tooltipDescription={isSettingsEnabled ? undefined : t('builder_chat_toolbar_available_soon')}
          className="ml-auto"
          label={t('builder_chat_toolbar_button_settings')}
          active={displayActiveTab === ChatTab.SETTINGS}
          disabled={isProcessing || isVersionHistoryOpen}
        />
      )}
    </Box>
  )
}
