'use client'

import { generateClickEID } from '@/utils/instrumentation'
import Box from '@ux/box'
import IconButton from '@/app/develop/components/IconButton'
import CheckboxListIcon from '@ux/icon/checkbox-list'
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
}

export default function ChatToolbar({ isProcessing = false }: ChatToolbarProps) {
  const {
    activeChatTab,
    setActiveChatTab,
    isMobile
  } = useDevelopPageStore()

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      className="pt-4 md:pt-0 px-4 pb-4"
    >
      { isMobile && (
        <IconButton
          icon={<WebsiteIcon />}
          dataEid={ generateClickEID('develop.chat_toolbar.preview') }
          onClick={() => { setActiveChatTab(ChatTab.PREVIEW) }}
          label="Preview"
          active={activeChatTab === ChatTab.PREVIEW}
        />
      )}
      <IconButton
        icon={<CommentsIcon />}
        dataEid={ generateClickEID('develop.chat_toolbar.chat') }
        onClick={() => { setActiveChatTab(ChatTab.CHAT) }}
        label="Chat"
        active={activeChatTab === ChatTab.CHAT}
      />
      <IconButton
        icon={<PaintBucketIcon />}
        dataEid={ generateClickEID('develop.chat_toolbar.styles') }
        label="Styles"
        active={activeChatTab === ChatTab.STYLES}
        tooltip="Available soon!"
      />
      <IconButton
        icon={<ImageIcon />}
        dataEid={ generateClickEID('develop.chat_toolbar.medias') }
        label="Medias"
        active={activeChatTab === ChatTab.MEDIAS}
        tooltip="Available soon!"
      />
      <IconButton
        icon={<CheckboxListIcon />}
        dataEid={ generateClickEID('develop.chat_toolbar.todo') }
        label="To-do"
        active={activeChatTab === ChatTab.TODO}
        tooltip="Available soon!"
      />
      <IconButton
        icon={<HistoryIcon />}
        dataEid={ generateClickEID('develop.chat_toolbar.history') }
        onClick={() => { setActiveChatTab(ChatTab.HISTORY) }}
        label="History"
        active={activeChatTab === ChatTab.HISTORY}
        disabled={isProcessing}
      />
      <IconButton
        icon={<SettingsIcon />}
        dataEid={ generateClickEID('develop.chat_toolbar.settings') }
        className="ml-auto"
        label="Settings"
        active={activeChatTab === ChatTab.SETTINGS}
        tooltip="Available soon!"
      />
    </Box>
  )
}
