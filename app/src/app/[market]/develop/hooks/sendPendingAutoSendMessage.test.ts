/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  sendPendingAutoSendMessage,
  type SendPendingAutoSendMessageOptions,
} from '@/app/[market]/develop/hooks/sendPendingAutoSendMessage'
import { logger } from '@/lib/request-context'
import type { SendMessageOptions } from '@/services/transport/messageTypes'

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const mockRetrieveAndUploadFiles = vi.fn().mockResolvedValue({ uploaded: [], failed: [] })
vi.mock('@/lib/quick-create', () => ({
  retrieveAndUploadFiles: (...args: unknown[]) => mockRetrieveAndUploadFiles(...args),
}))

const APP_ID = 'app-123'
const MESSAGE = 'Build me a landing page'
const TEMPLATE_ID = 'logo-designer'

interface BuildOptionsOverrides {
  send?: (options: SendMessageOptions) => Promise<void>
  setInputValue?: ReturnType<typeof vi.fn>
  markInitialPromptSent?: ReturnType<typeof vi.fn>
  markFirstFileEditSeen?: ReturnType<typeof vi.fn>
  onSettled?: ReturnType<typeof vi.fn>
  onUploadsFailed?: ReturnType<typeof vi.fn>
  templateId?: string | null
  designKitSlug?: string | null
  uploadedFiles?: Array<{ name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean }> | null
}

function buildOptions(overrides: BuildOptionsOverrides = {}): SendPendingAutoSendMessageOptions {
  return {
    messageToSend: MESSAGE,
    appId: APP_ID,
    templateId: 'templateId' in overrides ? overrides.templateId ?? null : TEMPLATE_ID,
    designKitSlug: overrides.designKitSlug ?? null,
    uploadedFiles: overrides.uploadedFiles ?? null,
    send: overrides.send ?? vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue(),
    setInputValue: overrides.setInputValue ?? vi.fn(),
    markInitialPromptSent: overrides.markInitialPromptSent ?? vi.fn(),
    markFirstFileEditSeen: overrides.markFirstFileEditSeen ?? vi.fn(),
    onSettled: overrides.onSettled ?? vi.fn(),
    onUploadsFailed: overrides.onUploadsFailed ?? vi.fn(),
  } as SendPendingAutoSendMessageOptions
}

describe('sendPendingAutoSendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards content, aiEditContext, and templateId to send on the success path', async () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()

    await sendPendingAutoSendMessage(buildOptions({ send }))

    expect(send).toHaveBeenCalledExactlyOnceWith({
      content: MESSAGE,
      aiEditContext: null,
      templateId: TEMPLATE_ID,
    })
  })

  it('omits templateId when null is provided (preserves "no template" semantics)', async () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()

    await sendPendingAutoSendMessage(buildOptions({ send, templateId: null }))

    expect(send).toHaveBeenCalledExactlyOnceWith({
      content: MESSAGE,
      aiEditContext: null,
      templateId: undefined,
    })
  })

  it('forwards designKitSlug to send when a kit is attached', async () => {
    const send = vi.fn().mockResolvedValue(undefined)

    await sendPendingAutoSendMessage(buildOptions({ send, designKitSlug: 'golden-hour' }))

    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ designKitSlug: 'golden-hour' }),
    )
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
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockRejectedValue(new Error('socket closed'))
    const setInputValue = vi.fn()

    await sendPendingAutoSendMessage(buildOptions({ send, setInputValue }))

    expect(setInputValue).toHaveBeenCalledExactlyOnceWith(MESSAGE)
  })

  it('logs the failure with appId and error message when send rejects', async () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockRejectedValue(new Error('socket closed'))

    await sendPendingAutoSendMessage(buildOptions({ send }))

    expect(logger.error).toHaveBeenCalledWith('develop-page.auto-send.failed', {
      error: 'socket closed',
      appId: APP_ID,
    })
  })

  it('coerces non-Error rejection values into a string for the failure log', async () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockRejectedValue('boom')

    await sendPendingAutoSendMessage(buildOptions({ send }))

    expect(logger.error).toHaveBeenCalledWith('develop-page.auto-send.failed', {
      error: 'boom',
      appId: APP_ID,
    })
  })

  it('still releases the lock and clears refs after a failed send', async () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockRejectedValue(new Error('socket closed'))
    const markInitialPromptSent = vi.fn()
    const onSettled = vi.fn()

    await sendPendingAutoSendMessage(
      buildOptions({ send, markInitialPromptSent, onSettled }),
    )

    expect(onSettled).toHaveBeenCalledOnce()
    expect(markInitialPromptSent).toHaveBeenCalledOnce()
  })

  it('does not throw when markInitialPromptSent throws on the success path', async () => {
    const markInitialPromptSent = vi.fn(function () {
      throw new Error('storage blocked')
    })

    await expect(
      sendPendingAutoSendMessage(buildOptions({ markInitialPromptSent })),
    ).resolves.toBeUndefined()
  })

  it('logs develop-page.auto-send.finally-failed when markInitialPromptSent throws', async () => {
    const markInitialPromptSent = vi.fn(function () {
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
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockRejectedValue(new Error('socket closed'))
    const markInitialPromptSent = vi.fn(function () {
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
    const onSettled = vi.fn(function () {
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
    const onSettled = vi.fn(function () {
      callOrder.push('onSettled')
    })
    const markInitialPromptSent = vi.fn(function () {
      callOrder.push('markInitialPromptSent')
      throw new Error('storage blocked')
    })

    await sendPendingAutoSendMessage(
      buildOptions({ onSettled, markInitialPromptSent }),
    )

    expect(callOrder).toEqual(['onSettled', 'markInitialPromptSent'])
  })

  it('calls markFirstFileEditSeen after successful app-import upload to dismiss overlay immediately', async () => {
    const markFirstFileEditSeen = vi.fn()
    mockRetrieveAndUploadFiles.mockResolvedValue({
      uploaded: [{ fileName: 'app.zip', raw: new ArrayBuffer(1), isDesignMd: false, isZip: true, isAppImport: true }],
      failed: [],
    })

    await sendPendingAutoSendMessage(
      buildOptions({
        markFirstFileEditSeen,
        uploadedFiles: [{ name: 'app.zip', content: '', isDesignMd: false, isZip: true, isAppImport: true }],
      }),
    )

    expect(markFirstFileEditSeen).toHaveBeenCalledOnce()
  })

  it('does not call markFirstFileEditSeen for non-app-import uploads', async () => {
    const markFirstFileEditSeen = vi.fn()
    mockRetrieveAndUploadFiles.mockResolvedValue({
      uploaded: [{ fileName: 'styles.zip', raw: new ArrayBuffer(1), isDesignMd: false, isZip: true }],
      failed: [],
    })

    await sendPendingAutoSendMessage(
      buildOptions({
        markFirstFileEditSeen,
        uploadedFiles: [{ name: 'styles.zip', content: '', isDesignMd: false, isZip: true }],
      }),
    )

    expect(markFirstFileEditSeen).not.toHaveBeenCalled()
  })

  it('calls markFirstFileEditSeen even when app-import upload fails (dismisses overlay)', async () => {
    const markFirstFileEditSeen = vi.fn()
    mockRetrieveAndUploadFiles.mockResolvedValue({ uploaded: [], failed: ['app.zip'] })

    await sendPendingAutoSendMessage(
      buildOptions({
        markFirstFileEditSeen,
        uploadedFiles: [{ name: 'app.zip', content: '', isDesignMd: false, isZip: true, isAppImport: true }],
      }),
    )

    expect(markFirstFileEditSeen).toHaveBeenCalledOnce()
  })

  it('calls onUploadsFailed when some files fail to upload', async () => {
    const onUploadsFailed = vi.fn()
    mockRetrieveAndUploadFiles.mockResolvedValue({
      uploaded: [{ fileName: 'ok.txt', raw: new ArrayBuffer(1), isDesignMd: false }],
      failed: ['bad.png'],
    })

    await sendPendingAutoSendMessage(
      buildOptions({
        onUploadsFailed,
        uploadedFiles: [
          { name: 'ok.txt', content: 'hi', isDesignMd: false },
          { name: 'bad.png', content: '', isDesignMd: false, isImage: true },
        ],
      }),
    )

    expect(onUploadsFailed).toHaveBeenCalledWith(['bad.png'])
  })

  it('does not include customContext when all uploads fail', async () => {
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()
    mockRetrieveAndUploadFiles.mockResolvedValue({ uploaded: [], failed: ['file.png'] })

    await sendPendingAutoSendMessage(
      buildOptions({
        send,
        uploadedFiles: [{ name: 'file.png', content: '', isDesignMd: false, isImage: true }],
      }),
    )

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      templateId: TEMPLATE_ID,
    }))
    expect(send).toHaveBeenCalledWith(expect.not.objectContaining({
      customContext: expect.anything(),
    }))
  })

  it('notifies onUploadsFailed with all expected files when retrieveAndUploadFiles throws', async () => {
    const onUploadsFailed = vi.fn()
    const send = vi.fn<(options: SendMessageOptions) => Promise<void>>().mockResolvedValue()
    mockRetrieveAndUploadFiles.mockRejectedValueOnce(new Error('IDB exploded'))

    await sendPendingAutoSendMessage(
      buildOptions({
        send,
        onUploadsFailed,
        uploadedFiles: [
          { name: 'a.txt', content: 'hi', isDesignMd: false },
          { name: 'b.png', content: '', isDesignMd: false, isImage: true },
        ],
      }),
    )

    // The catch must surface every expected file rather than sending silently.
    expect(onUploadsFailed).toHaveBeenCalledWith(['a.txt', 'b.png'])
    // And the prompt still sends, but without attached file context.
    expect(send).toHaveBeenCalledWith(expect.not.objectContaining({
      customContext: expect.anything(),
    }))
  })

  it('notifies onUploadsFailed when files were attached but none were found (empty uploaded + empty failed)', async () => {
    const onUploadsFailed = vi.fn()
    // Binaries missing from IndexedDB: resolves with nothing uploaded AND
    // nothing flagged failed — must not be a silent no-op.
    mockRetrieveAndUploadFiles.mockResolvedValueOnce({ uploaded: [], failed: [] })

    await sendPendingAutoSendMessage(
      buildOptions({
        onUploadsFailed,
        uploadedFiles: [
          { name: 'a.txt', content: 'hi', isDesignMd: false },
          { name: 'b.png', content: '', isDesignMd: false, isImage: true },
        ],
      }),
    )

    expect(onUploadsFailed).toHaveBeenCalledWith(['a.txt', 'b.png'])
  })
})
