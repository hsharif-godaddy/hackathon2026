'use client'

import { useState } from 'react'
import Box from '@ux/box'
import CommentsIcon from '@ux/icon/comments'
import HistoryIcon from '@ux/icon/history'
import ImageIcon from '@ux/icon/image'
import SettingsIcon from '@ux/icon/settings'
import WebsiteIcon from '@ux/icon/website'

import AssetManagerModal, { AssetManagerItem } from '@/app/develop/components/chat/AssetManagerModal'
import IconButton from '@/app/develop/components/IconButton'
import SettingsMenu from '@/app/develop/components/settings/SettingsMenu'
import { ChatTab } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useChatTabs } from '@/hooks/useChatTabs'
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
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit);

  const { data: isAssetManagerEnabled } = useSwitchboard('appbuilder-image-manager');
  const { data: isSettingsEnabled } = useSwitchboard('appbuilder-settings');

  const { isFetching: isFetchingCommits } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const [isAssetManagerOpen, setIsAssetManagerOpen] = useState(false)

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
      />
      {/* disable until we are sure we'll have this feature here
      <IconButton
        icon={<PaintBucketIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.styles')}
        label={t('builder_chat_toolbar_button_styles')}
        active={activeChatTab === ChatTab.STYLES}
        tooltip={t('builder_chat_toolbar_available_soon')}
      />
      */}
      {(!isMobile || (isMobile && isAssetManagerEnabled)) && (
        <IconButton
          icon={<ImageIcon />}
          dataEid={generateClickEID('develop.chat_toolbar.medias')}
          onClick={() => isAssetManagerEnabled ? setIsAssetManagerOpen(true) : undefined}
          label={t('builder_chat_toolbar_button_media')}
          active={isAssetManagerOpen}
          tooltipDescription={!isAssetManagerEnabled ? t('builder_chat_toolbar_available_soon') : undefined}
          disabled={isProcessing}
        />
      )}
      {/* disabled for now<IconButton
        icon={<CheckboxListIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.todo')}
        label={t('builder_chat_toolbar_button_todo)}
        active={activeChatTab === ChatTab.TODO}
        tooltip={t('builder_chat_toolbar_available_soon')}
      /> */}
      <IconButton
        icon={<HistoryIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.history')}
        onClick={() => handleTabClick(ChatTab.HISTORY)}
        label={t('builder_chat_toolbar_button_history')}
        active={activeChatTab === ChatTab.HISTORY}
        disabled={isProcessing || isFetchingCommits || isSelectingCommit}
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
