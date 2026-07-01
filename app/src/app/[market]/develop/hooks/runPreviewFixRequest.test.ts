/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewFixContext } from '@/app/[market]/develop/components/preview/types'
import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types'
import { runPreviewFixRequest, type RunPreviewFixRequestOptions } from '@/app/[market]/develop/hooks/runPreviewFixRequest'
import type { SendMessageOptions } from '@/services/transport/messageTypes'

const APP_ID = 'app-123'
const PROMPT = "My preview isn't working"
const FIXED_TIMESTAMP = 1_700_000_000_000
const SERVER_CTX: PreviewFixContext = {
  source: 'server',
  status: 'failed',
  failureKind: 'crash-loop',
}
const IFRAME_CTX: PreviewFixContext = { source: 'iframe' }

interface BuildOptionsOverrides {
  ctx?: PreviewFixContext
  appId?: string
  isMobile?: boolean
  isProcessing?: boolean
  setActiveChatTab?: ReturnType<typeof vi.fn>
  setOptimisticMobileTab?: ReturnType<typeof vi.fn>
  handleMobileModeChange?: ReturnType<typeof vi.fn>
  scheduleMicrotask?: (fn: () => void) => void
  send?: ReturnType<typeof vi.fn<(options: SendMessageOptions) => Promise<void>>>
  getPromptText?: () => string
  onSkippedProcessing?: ReturnType<typeof vi.fn>
  now?: () => number
}

function buildOptions(overrides: BuildOptionsOverrides = {}): RunPreviewFixRequestOptions {
  return {
    ctx: overrides.ctx ?? SERVER_CTX,
    appId: overrides.appId ?? APP_ID,
    isMobile: overrides.isMobile ?? false,
    isProcessing: overrides.isProcessing ?? false,
    setActiveChatTab: overrides.setActiveChatTab ?? vi.fn(),
    setOptimisticMobileTab: overrides.setOptimisticMobileTab ?? vi.fn(),
    handleMobileModeChange: overrides.handleMobileModeChange ?? vi.fn(),
    scheduleMicrotask: overrides.scheduleMicrotask ?? ((fn: () => void) => { fn() }),
    send: overrides.send ?? vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue(),
    getPromptText: overrides.getPromptText ?? (() => PROMPT),
    onSkippedProcessing: overrides.onSkippedProcessing,
    now: overrides.now ?? (() => FIXED_TIMESTAMP),
  }
}

describe('runPreviewFixRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends preview_fix with ctx spread into data on desktop when not processing', () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()

    runPreviewFixRequest(buildOptions({ send, ctx: SERVER_CTX }))

    expect(send).toHaveBeenCalledExactlyOnceWith({
      content: PROMPT,
      aiEditContext: null,
      isActionRequest: false,
      customContext: {
        type: 'preview_fix',
        data: {
          appId: APP_ID,
          timestamp: FIXED_TIMESTAMP,
          source: 'server',
          status: 'failed',
          failureKind: 'crash-loop',
        },
        persistence: 'ephemeral',
        source: 'preview-fix-button',
      },
    })
  })

  it('sends iframe ctx in preview_fix data payload', () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()

    runPreviewFixRequest(buildOptions({ send, ctx: IFRAME_CTX }))

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        customContext: expect.objectContaining({
          data: {
            appId: APP_ID,
            timestamp: FIXED_TIMESTAMP,
            source: 'iframe',
          },
        }),
      }),
    )
  })

  it('switches mobile tabs and sends when not processing', () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()
    const setActiveChatTab = vi.fn()
    const setOptimisticMobileTab = vi.fn()
    const handleMobileModeChange = vi.fn()

    runPreviewFixRequest(buildOptions({
      isMobile: true,
      send,
      setActiveChatTab,
      setOptimisticMobileTab,
      handleMobileModeChange,
    }))

    expect(setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT)
    expect(setOptimisticMobileTab).toHaveBeenCalledWith(ChatTab.CHAT)
    expect(handleMobileModeChange).toHaveBeenCalledWith(MobileMode.TOOLS)
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not send when processing on desktop', () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()
    const onSkippedProcessing = vi.fn()

    runPreviewFixRequest(buildOptions({
      isProcessing: true,
      send,
      onSkippedProcessing,
    }))

    expect(send).not.toHaveBeenCalled()
    expect(onSkippedProcessing).toHaveBeenCalledWith(SERVER_CTX)
  })

  it('switches mobile tabs but does not send when processing on mobile', () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()
    const setActiveChatTab = vi.fn()
    const setOptimisticMobileTab = vi.fn()
    const handleMobileModeChange = vi.fn()
    const onSkippedProcessing = vi.fn()

    runPreviewFixRequest(buildOptions({
      isMobile: true,
      isProcessing: true,
      send,
      setActiveChatTab,
      setOptimisticMobileTab,
      handleMobileModeChange,
      onSkippedProcessing,
    }))

    expect(setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT)
    expect(setOptimisticMobileTab).toHaveBeenCalledWith(ChatTab.CHAT)
    expect(handleMobileModeChange).toHaveBeenCalledWith(MobileMode.TOOLS)
    expect(send).not.toHaveBeenCalled()
    expect(onSkippedProcessing).toHaveBeenCalledWith(SERVER_CTX)
  })
})
