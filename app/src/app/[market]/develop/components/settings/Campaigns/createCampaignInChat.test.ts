/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { focusChatWithCreateCampaignPrompt } from './createCampaignInChat'

describe('focusChatWithCreateCampaignPrompt', () => {
  beforeEach(() => {
    useDevelopPageStore.setState({ activeChatTab: ChatTab.PREVIEW })
    useStreamingConversationStore.setState({ inputValue: '' })
    document.body.innerHTML = '<div id="chat-input-textarea" tabindex="0"></div>'
  })

  it('switches to chat and prefills the composer via store state', function prefill() {
    const setActiveChatTab = vi.spyOn(useDevelopPageStore.getState(), 'setActiveChatTab')
    const setInputValue = vi.spyOn(useStreamingConversationStore.getState(), 'setInputValue')
    const t = (key: string) => CAMPAIGN_DEFAULT_MESSAGES[key] ?? key

    focusChatWithCreateCampaignPrompt(t, 'Create a summer sale campaign')

    expect(setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT)
    expect(setInputValue).toHaveBeenCalledWith('Create a summer sale campaign')
    expect(document.activeElement?.id).toBe('chat-input-textarea')
  })

  it('uses the default create prompt when no prompt is provided', function defaultPrompt() {
    const setInputValue = vi.spyOn(useStreamingConversationStore.getState(), 'setInputValue')
    const t = (key: string) => CAMPAIGN_DEFAULT_MESSAGES[key] ?? key

    focusChatWithCreateCampaignPrompt(t)

    expect(setInputValue).toHaveBeenCalledWith(
      CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.campaignsCreatePrompt],
    )
  })
})
