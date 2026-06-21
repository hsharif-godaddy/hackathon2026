import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAppMock = vi.fn()
const getSSERegistryMock = vi.fn()

vi.mock('../sse/registry-singleton.js', () => ({
  getSSERegistry: () => getSSERegistryMock(),
}))

describe('emitMediaCaption', () => {
  beforeEach(() => {
    vi.resetModules()
    sendToAppMock.mockReset()
    getSSERegistryMock.mockReset().mockReturnValue({ sendToApp: sendToAppMock })
  })

  it('delivers the caption over SSE as a named media_caption event', async () => {
    const payload = { appId: 'app-1', slotName: 'hero.image', caption: 'A sunny beach' }
    const { emitMediaCaption } = await import('../media-caption-emit.js')
    emitMediaCaption(payload)

    expect(sendToAppMock).toHaveBeenCalledWith('app-1', 'media_caption', payload)
  })

  it('is a no-op when the SSE registry is not initialized', async () => {
    getSSERegistryMock.mockReturnValue(null)
    const { emitMediaCaption } = await import('../media-caption-emit.js')
    expect(() =>
      emitMediaCaption({ appId: 'app-2', slotName: 'about.image', caption: 'Team photo' }),
    ).not.toThrow()
    expect(sendToAppMock).not.toHaveBeenCalled()
  })
})
