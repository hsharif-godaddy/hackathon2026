/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendPendingAutoSendMessage } from '@/app/[market]/develop/hooks/sendPendingAutoSendMessage'
import { logger } from '@/lib/request-context'

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const APP_ID = 'app-123'
const MESSAGE = 'Build me a landing page'
const TEMPLATE_ID = 'logo-designer'

interface BuildOptionsOverrides {
  send?: ReturnType<typeof vi.fn>
  setInputValue?: ReturnType<typeof vi.fn>
  markInitialPromptSent?: ReturnType<typeof vi.fn>
  onSettled?: ReturnType<typeof vi.fn>
  templateId?: string | null
}

function buildOptions(overrides: BuildOptionsOverrides = {}) {
  return {
    messageToSend: MESSAGE,
    appId: APP_ID,
    templateId: 'templateId' in overrides ? overrides.templateId ?? null : TEMPLATE_ID,
    send: overrides.send ?? vi.fn().mockResolvedValue(undefined),
    setInputValue: overrides.setInputValue ?? vi.fn(),
    markInitialPromptSent: overrides.markInitialPromptSent ?? vi.fn(),
    onSettled: overrides.onSettled ?? vi.fn(),
  }
}

describe('sendPendingAutoSendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards content, aiEditContext, and templateId to send on the success path', async () => {
    const send = vi.fn().mockResolvedValue(undefined)

    await sendPendingAutoSendMessage(buildOptions({ send }))

    expect(send).toHaveBeenCalledExactlyOnceWith({
      content: MESSAGE,
      aiEditContext: null,
      templateId: TEMPLATE_ID,
    })
  })

  it('omits templateId when null is provided (preserves "no template" semantics)', async () => {
    const send = vi.fn().mockResolvedValue(undefined)

    await sendPendingAutoSendMessage(buildOptions({ send, templateId: null }))

    expect(send).toHaveBeenCalledExactlyOnceWith({
      content: MESSAGE,
      aiEditContext: null,
      templateId: undefined,
    })
  })

  it('clears the input on the success path so the editor does not wait for the first streaming chunk', async () => {
    const setInputValue = vi.fn()

    await sendPendingAutoSendMessage(buildOptions({ setInputValue }))

    expect(setInputValue).toHaveBeenCalledExactlyOnceWith('')
  })

  it('releases the lock and clears caller-owned refs on the success path', async () => {
    const markInitialPromptSent = vi.fn()
    const onSettled = vi.fn()

    await sendPendingAutoSendMessage(
      buildOptions({ markInitialPromptSent, onSettled }),
    )

    expect(onSettled).toHaveBeenCalledOnce()
    expect(markInitialPromptSent).toHaveBeenCalledOnce()
  })

  it('restores the prompt to the input when send rejects (catch path)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('socket closed'))
    const setInputValue = vi.fn()

    await sendPendingAutoSendMessage(buildOptions({ send, setInputValue }))

    expect(setInputValue).toHaveBeenCalledExactlyOnceWith(MESSAGE)
  })

  it('logs the failure with appId and error message when send rejects', async () => {
    const send = vi.fn().mockRejectedValue(new Error('socket closed'))

    await sendPendingAutoSendMessage(buildOptions({ send }))

    expect(logger.error).toHaveBeenCalledWith('develop-page.auto-send.failed', {
      error: 'socket closed',
      appId: APP_ID,
    })
  })

  it('coerces non-Error rejection values into a string for the failure log', async () => {
    const send = vi.fn().mockRejectedValue('boom')

    await sendPendingAutoSendMessage(buildOptions({ send }))

    expect(logger.error).toHaveBeenCalledWith('develop-page.auto-send.failed', {
      error: 'boom',
      appId: APP_ID,
    })
  })

  it('still releases the lock and clears refs after a failed send', async () => {
    const send = vi.fn().mockRejectedValue(new Error('socket closed'))
    const markInitialPromptSent = vi.fn()
    const onSettled = vi.fn()

    await sendPendingAutoSendMessage(
      buildOptions({ send, markInitialPromptSent, onSettled }),
    )

    expect(onSettled).toHaveBeenCalledOnce()
    expect(markInitialPromptSent).toHaveBeenCalledOnce()
  })

  it('does not throw when markInitialPromptSent throws on the success path', async () => {
    const markInitialPromptSent = vi.fn(() => {
      throw new Error('storage blocked')
    })

    await expect(
      sendPendingAutoSendMessage(buildOptions({ markInitialPromptSent })),
    ).resolves.toBeUndefined()
  })

  it('logs develop-page.auto-send.finally-failed when markInitialPromptSent throws', async () => {
    const markInitialPromptSent = vi.fn(() => {
      throw new Error('storage blocked')
    })

    await sendPendingAutoSendMessage(buildOptions({ markInitialPromptSent }))

    expect(logger.error).toHaveBeenCalledWith(
      'develop-page.auto-send.finally-failed',
      {
        error: 'storage blocked',
        appId: APP_ID,
      },
    )
  })

  it('emits both auto-send.failed and auto-send.finally-failed (with originalError) when send and markInitialPromptSent both throw', async () => {
    const send = vi.fn().mockRejectedValue(new Error('socket closed'))
    const markInitialPromptSent = vi.fn(() => {
      throw new Error('storage blocked')
    })

    await expect(
      sendPendingAutoSendMessage(buildOptions({ send, markInitialPromptSent })),
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith('develop-page.auto-send.failed', {
      error: 'socket closed',
      appId: APP_ID,
    })
    expect(logger.error).toHaveBeenCalledWith(
      'develop-page.auto-send.finally-failed',
      {
        error: 'storage blocked',
        appId: APP_ID,
        originalError: 'socket closed',
      },
    )
  })

  it('logs auto-send.on-settled-failed and still releases the lock when onSettled throws', async () => {
    const onSettled = vi.fn(() => {
      throw new Error('refs blocked')
    })
    const markInitialPromptSent = vi.fn()

    await expect(
      sendPendingAutoSendMessage(buildOptions({ onSettled, markInitialPromptSent })),
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'develop-page.auto-send.on-settled-failed',
      {
        error: 'refs blocked',
        appId: APP_ID,
      },
    )
    expect(markInitialPromptSent).toHaveBeenCalledOnce()
  })

  it('calls onSettled before markInitialPromptSent so refs clear even if the lock-release throws', async () => {
    const callOrder: string[] = []
    const onSettled = vi.fn(() => {
      callOrder.push('onSettled')
    })
    const markInitialPromptSent = vi.fn(() => {
      callOrder.push('markInitialPromptSent')
      throw new Error('storage blocked')
    })

    await sendPendingAutoSendMessage(
      buildOptions({ onSettled, markInitialPromptSent }),
    )

    expect(callOrder).toEqual(['onSettled', 'markInitialPromptSent'])
  })
})
