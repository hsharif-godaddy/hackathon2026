import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createForWorkspaceMock } = vi.hoisted(() => ({
  createForWorkspaceMock: vi.fn(),
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: createForWorkspaceMock,
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { markUploadsPlaced } from '../upload-classification-persistence.js'

interface Entry {
  fileName: string
  storedUploadFilename?: string
  slotUrl?: string
  placed?: boolean
}

/**
 * In-memory workspace backing `docs/.upload-classifications.json` so read-
 * modify-write (and the lock that protects it) are observable. A small async
 * delay on view forces interleaving in the concurrency test.
 */
function makeWorkspace(initial: Entry[], viewDelayMs = 0): { files: { view: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }; current: () => Entry[] } {
  let store: { files: Entry[] } = { files: initial }
  const files = {
    view: vi.fn(async () => {
      if (viewDelayMs) await new Promise((r) => setTimeout(r, viewDelayMs))
      return { content: JSON.stringify(store), encoding: 'utf-8', path: 'docs/.upload-classifications.json', lines: 1, size: 1, truncated: false }
    }),
    write: vi.fn(async ({ content }: { content: string }) => {
      store = JSON.parse(content)
      return { bytesWritten: content.length }
    }),
  }
  return { files, current: () => store.files }
}

describe('markUploadsPlaced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks placed and records slotUrl when matched by stored filename', async () => {
    const ws = makeWorkspace([{ fileName: 'photo.jpg', storedUploadFilename: 'app_1_photo.jpg' }])
    createForWorkspaceMock.mockReturnValue(ws)

    const ok = await markUploadsPlaced({ appId: 'a', storedFilename: 'app_1_photo.jpg', slotUrl: '/airo-assets/images/x' })

    expect(ok).toBe(true)
    expect(ws.current()[0]).toMatchObject({ placed: true, slotUrl: '/airo-assets/images/x' })
  })

  it('matches by fileName alone (the file-edit-utils asset-create arm) and marks placed', async () => {
    const ws = makeWorkspace([{ fileName: 'logo.png' }])
    createForWorkspaceMock.mockReturnValue(ws)

    const ok = await markUploadsPlaced({ appId: 'a', fileName: 'logo.png' })

    expect(ok).toBe(true)
    expect(ws.current()[0].placed).toBe(true)
    expect(ws.current()[0].slotUrl).toBeUndefined()
  })

  it('marks placed even when no slotUrl is supplied', async () => {
    const ws = makeWorkspace([{ fileName: 'p.jpg', storedUploadFilename: 'stored.jpg' }])
    createForWorkspaceMock.mockReturnValue(ws)

    const ok = await markUploadsPlaced({ appId: 'a', storedFilename: 'stored.jpg' })

    expect(ok).toBe(true)
    expect(ws.current()[0].placed).toBe(true)
  })

  it('returns false and does not write when already placed with the same slotUrl', async () => {
    const ws = makeWorkspace([{ fileName: 'p.jpg', storedUploadFilename: 'stored.jpg', slotUrl: '/x', placed: true }])
    createForWorkspaceMock.mockReturnValue(ws)

    const ok = await markUploadsPlaced({ appId: 'a', storedFilename: 'stored.jpg', slotUrl: '/x' })

    expect(ok).toBe(false)
    expect(ws.files.write).not.toHaveBeenCalled()
  })

  it('returns false with no identity (neither storedFilename nor fileName) without touching the workspace', async () => {
    const ok = await markUploadsPlaced({ appId: 'a' })
    expect(ok).toBe(false)
    expect(createForWorkspaceMock).not.toHaveBeenCalled()
  })

  it('returns false when the workspace is unavailable', async () => {
    createForWorkspaceMock.mockReturnValue(null)
    const ok = await markUploadsPlaced({ appId: 'a', storedFilename: 'stored.jpg' })
    expect(ok).toBe(false)
  })

  it('serializes concurrent writes under the per-app lock (no lost update)', async () => {
    // Two entries; mark each placed concurrently. With a view delay, an
    // unlocked read-modify-write would have the second writer overwrite the
    // first's mark. The lock must serialize so BOTH end up placed.
    const ws = makeWorkspace(
      [
        { fileName: 'a.jpg', storedUploadFilename: 'stored-a.jpg' },
        { fileName: 'b.jpg', storedUploadFilename: 'stored-b.jpg' },
      ],
      5,
    )
    createForWorkspaceMock.mockReturnValue(ws)

    await Promise.all([
      markUploadsPlaced({ appId: 'same-app', storedFilename: 'stored-a.jpg' }),
      markUploadsPlaced({ appId: 'same-app', storedFilename: 'stored-b.jpg' }),
    ])

    expect(ws.current().find((e) => e.fileName === 'a.jpg')?.placed).toBe(true)
    expect(ws.current().find((e) => e.fileName === 'b.jpg')?.placed).toBe(true)
  })
})
