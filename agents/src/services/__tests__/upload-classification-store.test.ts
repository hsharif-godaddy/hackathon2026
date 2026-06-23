import { describe, it, expect, vi, beforeEach } from 'vitest'

const { viewMock, writeMock, createForWorkspaceMock } = vi.hoisted(() => ({
  viewMock: vi.fn(),
  writeMock: vi.fn(),
  createForWorkspaceMock: vi.fn(),
}))

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: createForWorkspaceMock,
}))

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { recordUploadSlotUrl } from '../upload-classification-store.js'

function workspaceWith(content: string | (() => never)) {
  return {
    files: {
      view: viewMock.mockImplementation(async () => {
        if (typeof content === 'function') content()
        return { content, encoding: 'utf-8', path: 'docs/.upload-classifications.json', lines: 1, size: 1, truncated: false }
      }),
      write: writeMock.mockResolvedValue(undefined),
    },
  }
}

describe('recordUploadSlotUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets slotUrl on the entry matching storedUploadFilename and writes it back', async () => {
    createForWorkspaceMock.mockReturnValue(
      workspaceWith(JSON.stringify({
        files: [
          { fileName: 'photo.jpg', storedUploadFilename: 'stored-photo.jpg', placementIntent: 'display_on_site' },
          { fileName: 'other.jpg', storedUploadFilename: 'stored-other.jpg' },
        ],
      })),
    )

    const ok = await recordUploadSlotUrl({
      appId: 'app-1',
      storedFilename: 'stored-photo.jpg',
      slotUrl: '/airo-assets/images/products/sunrise',
    })

    expect(ok).toBe(true)
    expect(writeMock).toHaveBeenCalledTimes(1)
    const written = JSON.parse(writeMock.mock.calls[0][0].content)
    expect(written.files[0].slotUrl).toBe('/airo-assets/images/products/sunrise')
    // Unrelated entry untouched.
    expect(written.files[1].slotUrl).toBeUndefined()
  })

  it('matches by fileName when storedUploadFilename is absent', async () => {
    createForWorkspaceMock.mockReturnValue(
      workspaceWith(JSON.stringify({ files: [{ fileName: 'logo.png' }] })),
    )

    const ok = await recordUploadSlotUrl({ appId: 'app-1', storedFilename: 'logo.png', slotUrl: '/airo-assets/images/x' })

    expect(ok).toBe(true)
    expect(writeMock).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not write when no entry matches', async () => {
    createForWorkspaceMock.mockReturnValue(
      workspaceWith(JSON.stringify({ files: [{ fileName: 'a.jpg', storedUploadFilename: 'stored-a.jpg' }] })),
    )

    const ok = await recordUploadSlotUrl({ appId: 'app-1', storedFilename: 'nope.jpg', slotUrl: '/x' })

    expect(ok).toBe(false)
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('returns false when the classifications file is missing', async () => {
    createForWorkspaceMock.mockReturnValue(
      workspaceWith(() => { throw new Error('not_found') }),
    )

    const ok = await recordUploadSlotUrl({ appId: 'app-1', storedFilename: 'x.jpg', slotUrl: '/x' })

    expect(ok).toBe(false)
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('does not throw when the workspace is unavailable', async () => {
    createForWorkspaceMock.mockReturnValue(null)

    const ok = await recordUploadSlotUrl({ appId: 'app-1', storedFilename: 'x.jpg', slotUrl: '/x' })

    expect(ok).toBe(false)
  })

  it('returns false (no rewrite) when already placed with the same slotUrl', async () => {
    createForWorkspaceMock.mockReturnValue(
      workspaceWith(JSON.stringify({
        files: [{ fileName: 'p.jpg', storedUploadFilename: 'stored-p.jpg', slotUrl: '/airo-assets/images/p', placed: true }],
      })),
    )

    const ok = await recordUploadSlotUrl({ appId: 'app-1', storedFilename: 'stored-p.jpg', slotUrl: '/airo-assets/images/p' })

    expect(ok).toBe(false)
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('marks the upload placed (writes) even when the slotUrl is unchanged but placed was not yet set', async () => {
    createForWorkspaceMock.mockReturnValue(
      workspaceWith(JSON.stringify({
        files: [{ fileName: 'p.jpg', storedUploadFilename: 'stored-p.jpg', slotUrl: '/airo-assets/images/p' }],
      })),
    )

    const ok = await recordUploadSlotUrl({ appId: 'app-1', storedFilename: 'stored-p.jpg', slotUrl: '/airo-assets/images/p' })

    expect(ok).toBe(true)
    const written = JSON.parse(writeMock.mock.calls[0][0].content)
    expect(written.files[0].placed).toBe(true)
  })
})
