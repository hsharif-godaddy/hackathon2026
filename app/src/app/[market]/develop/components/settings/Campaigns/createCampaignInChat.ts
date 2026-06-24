'use client'

import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { ChatTab } from '@/app/[market]/develop/components/types'
import type { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

export function focusChatWithCreateCampaignPrompt(t: ReturnType<typeof useTranslations>) {
  useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT)
  useStreamingConversationStore.getState().setInputValue(
    translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreatePrompt),
  )
  const editor = document.getElementById('chat-input-textarea')
  editor?.focus()
}
