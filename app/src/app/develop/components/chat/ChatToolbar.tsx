'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AssetManagerModal, { AssetManagerItem } from '@/app/develop/components/chat/AssetManagerModal'
import SettingsMenu from '@/app/develop/components/settings/SettingsMenu'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { generateClickEID } from '@/utils/instrumentation'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { useGitStore } from '@/stores/useGitStore'
import Box from '@ux/box'
import IconButton from '@/app/develop/components/IconButton'
import CommentsIcon from '@ux/icon/comments'
import HistoryIcon from '@ux/icon/history'
import ImageIcon from '@ux/icon/image'
import PaintBucketIcon from '@ux/icon/paint-bucket'
import SettingsIcon from '@ux/icon/settings'
import WebsiteIcon from '@ux/icon/website'
import { ChatTab } from '@/app/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
interface ChatToolbarProps {
  isProcessing?: boolean
  onAssetSelect?: (items: AssetManagerItem[]) => void
  ventureId: string | null
}

export default function ChatToolbar({ isProcessing = false, onAssetSelect, ventureId }: ChatToolbarProps) {
  const router = useRouter()
  const appId = useAppIdFromParams()
  const activeChatTab = useDevelopPageStore((state) => state.activeChatTab);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);
  const isSelectingCommit = useGitStore((state) => state.isSelectingCommit);

  const { data: isAssetManagerEnabled } = useSwitchboard('appbuilder-image-manager');
  const { data: isSettingsEnabled } = useSwitchboard('appbuilder-settings');
  // const { data: isSettingsEnabled } = {data: true};

  const { isFetching: isFetchingCommits } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const [isAssetManagerOpen, setIsAssetManagerOpen] = useState(false)

  function handleAssetSelect(items: AssetManagerItem[]) {
    console.log('Assets selected in ChatToolbar:', items)
    if (onAssetSelect) {
      onAssetSelect(items)
    }
  }

  const handleTabClick = (tab: ChatTab) => {
    setActiveChatTab(tab)

    // Update URL for deep linking
    const params = new URLSearchParams()

    switch (tab) {
      case ChatTab.SETTINGS:
        params.set('tab', 'settings')
        params.set('settings', activeSettingsSection)
        break
      case ChatTab.HISTORY:
        params.set('tab', 'history')
        break
      case ChatTab.PREVIEW:
        params.set('tab', 'preview')
        break
      case ChatTab.CHAT:
        // Chat is the default, no param needed
        break
      default:
        break
    }

    const url = params.toString()
      ? `/develop/${appId}?${params.toString()}`
      : `/develop/${appId}`

    router.push(url, { scroll: false })
  }

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      className="pt-4 md:pt-0 px-4 pb-4"
    >
      {isMobile && (
        <IconButton
          icon={<WebsiteIcon />}
          dataEid={generateClickEID('develop.chat_toolbar.preview')}
          onClick={() => handleTabClick(ChatTab.PREVIEW)}
          label="Preview"
          active={activeChatTab === ChatTab.PREVIEW}
        />
      )}
      <IconButton
        icon={<CommentsIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.chat')}
        onClick={() => handleTabClick(ChatTab.CHAT)}
        label="Chat"
        active={activeChatTab === ChatTab.CHAT}
      />
      <IconButton
        icon={<PaintBucketIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.styles')}
        label="Styles"
        active={activeChatTab === ChatTab.STYLES}
        tooltip="Available soon!"
      />
      <IconButton
        icon={<ImageIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.medias')}
        onClick={() => { if (isAssetManagerEnabled) setIsAssetManagerOpen(true) }}
        label="Media"
        active={isAssetManagerOpen}
        tooltip={!isAssetManagerEnabled ? 'Available soon!' : undefined}
        disabled={isProcessing}
      />
      {/* disabled for now<IconButton
        icon={<CheckboxListIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.todo')}
        label="To-do"
        active={activeChatTab === ChatTab.TODO}
        tooltip="Available soon!"
      /> */}
      <IconButton
        icon={<HistoryIcon />}
        dataEid={generateClickEID('develop.chat_toolbar.history')}
        onClick={() => handleTabClick(ChatTab.HISTORY)}
        label="History"
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
          tooltip={isSettingsEnabled ? undefined : "Available soon!"}
          className="ml-auto"
          label="Settings"
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
