import type { PreviewFixContext } from '@/app/[market]/develop/components/preview/types'
import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types'
import type { SendMessageOptions } from '@/services/transport/messageTypes'

export interface RunPreviewFixRequestOptions {
  ctx: PreviewFixContext
  appId: string
  isMobile: boolean
  isProcessing: boolean
  setActiveChatTab: (tab: ChatTab) => void
  setOptimisticMobileTab: (tab: ChatTab) => void
  handleMobileModeChange: (mode: MobileMode) => void
  scheduleMicrotask: (fn: () => void) => void
  send: (options: SendMessageOptions) => Promise<void>
  getPromptText: () => string
  onSkippedProcessing?: (ctx: PreviewFixContext) => void
  now?: () => number
}

export function runPreviewFixRequest(opts: RunPreviewFixRequestOptions): void {
  const {
    ctx,
    appId,
    isMobile,
    isProcessing,
    setActiveChatTab,
    setOptimisticMobileTab,
    handleMobileModeChange,
    scheduleMicrotask,
    send,
    getPromptText,
    onSkippedProcessing,
    now = () => Date.now(),
  } = opts

  if (isMobile) {
    setActiveChatTab(ChatTab.CHAT)
    setOptimisticMobileTab(ChatTab.CHAT)
    handleMobileModeChange(MobileMode.TOOLS)
  }

  if (isProcessing) {
    onSkippedProcessing?.(ctx)
    return
  }

  const promptText: string = getPromptText()
  scheduleMicrotask(function sendPreviewFixMessage() {
    void send({
      content: promptText,
      aiEditContext: null,
      isActionRequest: false,
      customContext: {
        type: 'preview_fix',
        data: { appId, timestamp: now(), ...ctx },
        persistence: 'ephemeral',
        source: 'preview-fix-button',
      },
    })
  })
}
