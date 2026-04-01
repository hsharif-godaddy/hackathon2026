'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import CodeIcon from '@ux/icon/code'
import CommentsIcon from '@ux/icon/comments'
import EditIcon from '@ux/icon/edit'
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
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled'
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
  const { activeChatTab, setActiveChatTab } = useChatTabs()
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const mobileMode = useDevelopPageStore((state) => state.mobileMode);
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges);
  const toggleSelectMode = useDevelopPageStore((state) => state.toggleSelectMode);
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange);

  // Use optimistic tab for UI selection state, fall back to URL-based state
  const displayActiveTab = optimisticActiveTab ?? activeChatTab
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode);
  const returnToMain = useGitStore((state) => state.returnToMain);
  const setSelectedCommitHash = useGitStore((state) => state.setSelectedCommitHash);
  const isHistoryDisabled = useIsHistoryDisabled(appId || '');

  const { data: gitHistoryData } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const latestCommitHash = gitHistoryData?.commits?.[0]?.hash || null

  // Track previous values to detect mode changes
  const prevViewModeRef = useRef<ViewMode>(viewMode)
  const prevSelectModeRef = useRef<boolean>(isSelectMode)
  const prevChatTabRef = useRef<ChatTab>(activeChatTab)
  const settingsMenuRef = useRef<SettingsMenuRef>(null)

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
      // Reset selected commit hash to the latest commit to prevent showing historical commit
      // banner during the async returnToMain operation. This provides smooth UX when switching
      // from History tab to Chat/Preview tab.
      setSelectedCommitHash(appId, latestCommitHash)

      // Trigger async backend checkout to main branch
      returnToMain(appId, latestCommitHash)
    }
  }, [appId, viewMode, isSelectMode, activeChatTab, latestCommitHash, returnToMain, setSelectedCommitHash])


  const handleTabClick = (tab: ChatTab) => {
    // Call optimistic callback first for instant UI updates
    onBeforeTabChange?.(tab)

    if (tab === ChatTab.SETTINGS && isMobile) {
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
              disabled={isHistoryDisabled}
              data-eid={generateClickEID('develop.chat_toolbar.history')}
            />
            <SettingsMenu ref={settingsMenuRef} />
          </ButtonGroup>

          {isMobile && <AppPublish location="develop.chat_toolbar" />}
        </>
      )}

      {/* PREVIEW mode: Edit + View/Code + Refresh + Domain + Publish */}
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
              {viewMode === ViewMode.PREVIEW && (
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut', delay: 0.5 }}
                >
                  <Box orientation="horizontal" gap="sm">
                    <IconButton
                      icon={<EditIcon className="size-2.5" />}
                      onClick={toggleSelectMode}
                      active={isSelectMode}
                      label={t('builder_chat_toolbar_button_edit')}
                      data-eid={generateClickEID('develop.chat_toolbar.edit')}
                    />

                    {onPreviewRefresh && (
                      <IconButton
                        icon={<RefreshIcon className="size-2.5" />}
                        onClick={onPreviewRefresh}
                        data-eid={generateClickEID('develop.chat_toolbar.refresh')}
                        label={t('builder_preview_button_refresh')}
                        showLabelWhenActive={false}
                      />
                    )}
                  </Box>
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
