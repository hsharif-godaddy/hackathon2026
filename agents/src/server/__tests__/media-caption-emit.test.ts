import { beforeEach, describe, expect, it, vi } from 'vitest'

const emitToAppMock = vi.fn()
const sendToAppMock = vi.fn()
const getSSERegistryMock = vi.fn()

vi.mock('../ai-lib-websocket-server.js', () => ({
  emitToApp: (...args: unknown[]) => emitToAppMock(...args),
}))

vi.mock('../sse/registry-singleton.js', () => ({
  getSSERegistry: () => getSSERegistryMock(),
}))

describe('emitMediaCaption', () => {
  beforeEach(() => {
    vi.resetModules()
    emitToAppMock.mockReset().mockReturnValue(1)
    sendToAppMock.mockReset()
    getSSERegistryMock.mockReset().mockReturnValue({ sendToApp: sendToAppMock })
  })

  it('delivers the caption over both WS (message envelope) and SSE (media_caption)', async () => {
    const payload = { appId: 'app-1', slotName: 'hero.image', caption: 'A sunny beach' }
    const { emitMediaCaption } = await import('../media-caption-emit.js')
    emitMediaCaption(payload)

    expect(emitToAppMock).toHaveBeenCalledWith('app-1', 'message', {
      type: 'media_caption',
      content: '',
      data: payload,
    })
    expect(sendToAppMock).toHaveBeenCalledWith('app-1', 'media_caption', payload)
  })

  it('skips the SSE emit when the registry is not initialized (WS still fires)', async () => {
    getSSERegistryMock.mockReturnValue(null)
    const { emitMediaCaption } = await import('../media-caption-emit.js')
    emitMediaCaption({ appId: 'app-2', slotName: 'about.image', caption: 'Team photo' })

    expect(emitToAppMock).toHaveBeenCalled()
    expect(sendToAppMock).not.toHaveBeenCalled()
  })
})
