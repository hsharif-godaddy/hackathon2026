'use client'

import { generateClickEID } from '@/utils/instrumentation'
import Box from '@ux/box'
import IconButton from '@/app/develop/components/IconButton'
import CheckboxListIcon from '@ux/icon/checkbox-list'
import CommentsIcon from '@ux/icon/comments'
import DashboardFillesIcon from '@ux/icon/dashboard-filled'
import HistoryIcon from '@ux/icon/history'
import ImageIcon from '@ux/icon/image'
import PaintBucketIcon from '@ux/icon/paint-bucket'
import SettingsIcon from '@ux/icon/settings'
import WebsiteIcon from '@ux/icon/website'
import { ChatTab } from '@/app/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

export default function ChatToolbar() {
  const {
    activeChatTab,
    setActiveChatTab,
    isMobile
  } = useDevelopPageStore()

  return (
    <Box
      orientation="horizontal"
      gap="sm"
      className="p-2 md:px-4 md:pb-4"
    >
      { isMobile ? (
        <IconButton
          icon={<WebsiteIcon className="w-4 h-4" />}
          dataEid={ generateClickEID('develop.chat_toolbar.preview') }
          onClick={() => { setActiveChatTab(ChatTab.PREVIEW) }}
          label="Preview"
          active={activeChatTab === ChatTab.PREVIEW}
        />
      ) : (
        <IconButton
          icon={<DashboardFillesIcon className="w-4 h-4" />}
          dataEid={ generateClickEID('develop.chat_toolbar.apps') }
          onClick={() => { setActiveChatTab(ChatTab.APPS) }}
          label="Apps"
          active={activeChatTab === ChatTab.APPS}
          availableSoon
        />
      )}
      <IconButton
        icon={<CommentsIcon className="w-4 h-4" />}
        dataEid={ generateClickEID('develop.chat_toolbar.chat') }
        onClick={() => { setActiveChatTab(ChatTab.CHAT) }}
        label="Chat"
        active={activeChatTab === ChatTab.CHAT}
      />
      <IconButton
        icon={<PaintBucketIcon className="w-4 h-4" />}
        dataEid={ generateClickEID('develop.chat_toolbar.styles') }
        onClick={() => { setActiveChatTab(ChatTab.STYLES) }}
        label="Styles"
        active={activeChatTab === ChatTab.STYLES}
        availableSoon
      />
      <IconButton
        icon={<ImageIcon className="w-4 h-4" />}
        dataEid={ generateClickEID('develop.chat_toolbar.medias') }
        onClick={() => { setActiveChatTab(ChatTab.MEDIAS) }}
        label="Medias"
        active={activeChatTab === ChatTab.MEDIAS}
        availableSoon
      />
      <IconButton
        icon={<CheckboxListIcon className="w-4 h-4" />}
        dataEid={ generateClickEID('develop.chat_toolbar.todo') }
        onClick={() => { setActiveChatTab(ChatTab.TODO) }}
        label="To-do"
        active={activeChatTab === ChatTab.TODO}
        availableSoon
      />
      <IconButton
        icon={<HistoryIcon className="w-4 h-4" />}
        dataEid={ generateClickEID('develop.chat_toolbar.history') }
        onClick={() => { setActiveChatTab(ChatTab.HISTORY) }}
        label="History"
        active={activeChatTab === ChatTab.HISTORY}
      />
      <IconButton
        icon={<SettingsIcon className="w-4 h-4" />}
        dataEid={ generateClickEID('develop.chat_toolbar.settings') }
        onClick={() => { setActiveChatTab(ChatTab.SETTINGS) }}
        className="ml-auto"
        active={activeChatTab === ChatTab.SETTINGS}
        availableSoon
      />
    </Box>
  )
}
