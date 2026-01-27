'use client'

import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import CommentsIcon from '@ux/icon/comments'
import HistoryIcon from '@ux/icon/history'
import ImageIcon from '@ux/icon/image'
import SettingsIcon from '@ux/icon/settings'
import WebsiteIcon from '@ux/icon/website'

import AssetManagerModal, { AssetManagerItem } from '@/app/develop/components/chat/AssetManagerModal'
import IconButton from '@/app/develop/components/IconButton'
import SettingsMenu from '@/app/develop/components/settings/SettingsMenu'
import { ChatTab, ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { generateClickEID } from '@/utils/instrumentation'

interface ChatToolbarProps {
  isProcessing?: boolean
  onAssetSelect?: (items: AssetManagerItem[]) => void
  ventureId: string | null
}

export default function ChatToolbar({ isProcessing = false, onAssetSelect, ventureId }: ChatToolbarProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams()
  const { activeChatTab, setActiveChatTab, activeSettingsSection, setActiveSettingsSection } = useChatTabs()
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen);
  const viewMode = useDevelopPageStore((state) => state.viewMode);
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode);
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit);
  const returnToMain = useGitStore((state) => state.returnToMain);

  const { data: isAssetManagerEnabled } = useSwitchboard('appbuilder-image-manager');
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

  const isAssetManagerOpen = useDevelopPageStore((state) => state.isAssetManagerOpen);
  const setIsAssetManagerOpen = useDevelopPageStore((state) => state.setIsAssetManagerOpen);

  function handleAssetSelect(items: AssetManagerItem[]) {
    logger.debug('chat_toolbar.assets.selected', {
      itemCount: items.length,
      items: items.map(i => ({ mediaType: i.mediaType, sourceType: i.sourceType }))
    })
    if (onAssetSelect) {
      onAssetSelect(items)
    }
  }

  const handleTabClick = (tab: ChatTab) => {
    if (tab === ChatTab.SETTINGS) {
      // Preserve or initialize settings section when opening the settings tab
      setActiveSettingsSection(activeSettingsSection)
      return
    }

    setActiveChatTab(tab)
  }

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      className="pt-2 md:pt-0 pb-2 md:pb-0 px-2 sm:px-3 md:p-0"
      style={isMobile ? { paddingBottom: `calc(0.5rem + env(safe-area-inset-bottom))` } : undefined}
    >
      {isMobile && (
        <IconButton
          icon={<WebsiteIcon />}
          dataEid={generateClickEID('develop.chat_toolbar.preview')}
          onClick={() => handleTabClick(ChatTab.PREVIEW)}
          label={t('builder_chat_toolbar_button_preview')}
          active={activeChatTab === ChatTab.PREVIEW}
        />
      )}
      <IconButton
        icon={<CommentsIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.chat')}
        onClick={() => handleTabClick(ChatTab.CHAT)}
        label={t('builder_chat_toolbar_button_chat')}
        active={activeChatTab === ChatTab.CHAT}
        showLabelAlways={!isMobile}
      />
      {isAssetManagerEnabled && (
        <IconButton
          icon={<ImageIcon />}
          dataEid={generateClickEID('develop.chat_toolbar.medias')}
          onClick={() => isAssetManagerEnabled ? setIsAssetManagerOpen(true) : undefined}
          label={t('builder_chat_toolbar_button_media')}
          active={isAssetManagerOpen}
          tooltipDescription={!isAssetManagerEnabled ? t('builder_chat_toolbar_available_soon') : undefined}
          disabled={isProcessing}
          showLabelAlways={!isMobile}
        />
      )}
      <IconButton
        icon={<HistoryIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.history')}
        onClick={() => handleTabClick(ChatTab.HISTORY)}
        label={t('builder_chat_toolbar_button_history')}
        active={activeChatTab === ChatTab.HISTORY}
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
          active={activeChatTab === ChatTab.SETTINGS}
          disabled={isProcessing || isVersionHistoryOpen}
        />
      )}
      {isAssetManagerEnabled && (
        <AssetManagerModal
          isOpen={isAssetManagerOpen}
          onClose={() => { setIsAssetManagerOpen(false) }}
          onItemsSelected={handleAssetSelect}
          ventureId={ventureId}
        />
      )}
    </Box>
  )
}
