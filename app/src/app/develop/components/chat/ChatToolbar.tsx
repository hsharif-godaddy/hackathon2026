'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import CodeIcon from '@ux/icon/code'
import CommentsIcon from '@ux/icon/comments'
import GraphIcon from '@ux/icon/graph'
import HistoryIcon from '@ux/icon/history'
import ImageIcon from '@ux/icon/image'
import RefreshIcon from '@ux/icon/refresh'
import ShowIcon from '@ux/icon/show'

import { ButtonGroup } from '@/app/develop/components/ButtonGroup'
import IconButton from '@/app/develop/components/IconButton'
import DomainMenu from '@/app/develop/components/layout/DomainMenu'
import SettingsMenu, { SettingsMenuRef } from '@/app/develop/components/settings/SettingsMenu'
import { ChatTab, MobileMode, ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import AppPublish from '@/components/layout/AppPublish'
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
  className?: string
  onBeforeTabChange?: (tab: ChatTab) => void
  optimisticActiveTab?: ChatTab
  onPreviewRefresh?: () => void
}

export default function ChatToolbar({
    className = '',
    onBeforeTabChange,
    optimisticActiveTab,
    onPreviewRefresh
  }: ChatToolbarProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams()
  const { activeChatTab, setActiveChatTab, setActiveSettingsSection } = useChatTabs()
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const mobileMode = useDevelopPageStore((state) => state.mobileMode);
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges);
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange);

  // Use optimistic tab for UI selection state, fall back to URL-based state
  const displayActiveTab = optimisticActiveTab ?? activeChatTab
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const returnToMain = useGitStore((state) => state.returnToMain);
  const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash);
  const { data: isAnalyticsEnabled } = useSwitchboard('appbuilder-analytics');

  const { data: gitHistoryData } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const latestCommitHash = gitHistoryData?.commits?.[0]?.hash || null

  // Track previous values to detect mode changes
  const prevViewModeRef = useRef<ViewMode>(viewMode)
  const prevChatTabRef = useRef<ChatTab>(activeChatTab)
  const settingsMenuRef = useRef<SettingsMenuRef>(null)

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
      // Reset selected commit hash to the latest commit to prevent showing historical commit
      // banner during the async returnToMain operation. This provides smooth UX when switching
      // from History tab to Chat/Preview tab.
      setSelectedCommitHash(appId, latestCommitHash)

      // Trigger async backend checkout to main branch
      returnToMain(appId, latestCommitHash)
    }
  }, [appId, viewMode, activeChatTab, latestCommitHash, returnToMain, setSelectedCommitHash])


  const handleTabClick = (tab: ChatTab) => {
    // Call optimistic callback first for instant UI updates
    onBeforeTabChange?.(tab)

    if (tab === ChatTab.SETTINGS) {
      // Open the settings popover instead of navigating
      settingsMenuRef.current?.openPopover()
      return
    }

    // This will update the URL, but the optimistic state is already updated above
    setActiveChatTab(tab)
  }

  // Desktop: Always show TOOLS mode
  // Mobile: Show different toolbars based on mobileMode
  const showToolsMode = !isMobile || mobileMode === MobileMode.TOOLS;
  const showPreviewMode = isMobile && mobileMode === MobileMode.PREVIEW;

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      inlineAlignChildren="center"
      blockAlignChildren='spaceBetween'
      className={cn("pt-0 pb-1 md:pb-2 md:pb-0 px-1.5 sm:px-3 md:p-0", className)}
      style={isMobile ? { paddingBottom: `calc(0.25rem + env(safe-area-inset-bottom))` } : undefined}
    >
      {/* TOOLS mode: Chat + History buttons */}
      {showToolsMode && (
        <>
          <ButtonGroup
            value={displayActiveTab}
            onChange={(value) => handleTabClick(value as ChatTab)}
            data-eid={generateClickEID('develop.chat_toolbar.tab_group')}
          >
            <ButtonGroup.Item
              value={ChatTab.CHAT}
              icon={<CommentsIcon className="size-2.5" />}
              label={t('builder_chat_toolbar_button_chat')}
              data-eid={generateClickEID('develop.chat_toolbar.chat')}
            />
            <ButtonGroup.Item
              value={ChatTab.MEDIAS}
              icon={<ImageIcon />}
              label={t('builder_chat_toolbar_button_media')}
              data-eid={generateClickEID('develop.chat_toolbar.media')}
            />
            <ButtonGroup.Item
              value={ChatTab.HISTORY}
              icon={<HistoryIcon className="size-2.5" />}
              label={t('builder_chat_toolbar_button_history')}
              data-eid={generateClickEID('develop.chat_toolbar.history')}
            />
            {isAnalyticsEnabled && (
              <ButtonGroup.Item
                value={ChatTab.ANALYTICS}
                icon={<GraphIcon className="size-2.5" />}
                label={t('builder_settings_nav_analytics')}
                data-eid={generateClickEID('develop.chat_toolbar.analytics')}
              />
            )}
            <SettingsMenu ref={settingsMenuRef} />
          </ButtonGroup>

          {isMobile && <AppPublish location="develop.chat_toolbar" />}
        </>
      )}

      {/* PREVIEW mode: View/Code + Refresh + Domain + Publish */}
      {showPreviewMode && (
        <>
          <Box orientation="horizontal" gap="sm">
            {/* View/Code ButtonGroup */}
            <ButtonGroup
              value={viewMode}
              onChange={(value) => handleViewModeChange(value as ViewMode, hasUnsavedChanges)}
              data-eid={generateClickEID('develop.chat_toolbar.view_mode_group')}
            >
              <ButtonGroup.Item
                value={ViewMode.PREVIEW}
                icon={<ShowIcon className="size-2.5" />}
                label={t('builder_chat_toolbar_button_view')}
                data-eid={generateClickEID('develop.chat_toolbar.view')}
              />
              <ButtonGroup.Item
                value={ViewMode.CODE}
                icon={<CodeIcon className="size-2.5" />}
                label={t('builder_chat_toolbar_button_code')}
                data-eid={generateClickEID('develop.chat_toolbar.code')}
              />
            </ButtonGroup>

            <AnimatePresence>
              {viewMode === ViewMode.PREVIEW && onPreviewRefresh && (
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut', delay: 0.5 }}
                >
                  <IconButton
                    icon={<RefreshIcon className="size-2.5" />}
                    onClick={onPreviewRefresh}
                    data-eid={generateClickEID('develop.chat_toolbar.refresh')}
                    label={t('builder_preview_button_refresh')}
                    showLabelWhenActive={false}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Box>

          <Box orientation="horizontal" gap="sm">
            <DomainMenu />
            <AppPublish location="develop.chat_toolbar" />
          </Box>
        </>
      )}
    </Box>
  )
}
