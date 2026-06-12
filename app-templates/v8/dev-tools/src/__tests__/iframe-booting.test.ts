import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/postMessage', () => ({ safePostMessage: vi.fn() }))

import { safePostMessage } from '../utils/postMessage'
import { postIframeBootingBeacon } from '../iframe-booting'

describe('postIframeBootingBeacon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts an IFRAME_BOOTING message to the parent when embedded in an iframe', () => {
    const parent = {} as unknown as Window
    const win = { parent } as unknown as Window

    postIframeBootingBeacon(win)

    expect(safePostMessage).toHaveBeenCalledTimes(1)
    expect(safePostMessage).toHaveBeenCalledWith(parent, { type: 'IFRAME_BOOTING' })
  })

  it('does nothing at the top level (parent === self)', () => {
    const win = {} as unknown as Window & { parent?: unknown }
    ;(win as { parent: unknown }).parent = win

    postIframeBootingBeacon(win as unknown as Window)

    expect(safePostMessage).not.toHaveBeenCalled()
  })

  it('does nothing when there is no window (SSR / non-browser)', () => {
    postIframeBootingBeacon(undefined)

    expect(safePostMessage).not.toHaveBeenCalled()
  })

  it('swallows postMessage errors (best-effort beacon)', () => {
    const parent = {} as unknown as Window
    const win = { parent } as unknown as Window
    ;(safePostMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('postMessage blocked')
    })

    expect(() => postIframeBootingBeacon(win)).not.toThrow()
  })
})
