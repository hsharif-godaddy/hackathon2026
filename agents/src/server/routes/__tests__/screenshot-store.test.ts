import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { createForWorkspace } from '../../../workspace/index.js'
import type { WorkspaceClient } from '../../../workspace/index.js'
import type { StatEntry } from '../../../workspace/files.js'
import { getScreenshotStore } from '../screenshot-store.js'

const mockedCreateForWorkspace = vi.mocked(createForWorkspace)

function createMockWorkspace(overrides?: {
  upload?: ReturnType<typeof vi.fn>
  download?: ReturnType<typeof vi.fn>
  stat?: ReturnType<typeof vi.fn>
}): WorkspaceClient {
  return {
    workspaceId: 'test-ws',
    variant: 'preview' as const,
    files: {
      upload: overrides?.upload ?? vi.fn().mockResolvedValue({ bytesWritten: 100 }),
      download: overrides?.download ?? vi.fn().mockResolvedValue({ data: Buffer.from('PNG') }),
      stat: overrides?.stat ?? vi.fn().mockResolvedValue({ entries: [{ path: 'x', kind: 'file', size: 100, modifiedAt: '' }] }),
    },
  } as unknown as WorkspaceClient
}

describe('screenshot-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SCREENSHOT_DIR
  })

  describe('getScreenshotStore routing', () => {
    it('returns host store when SCREENSHOT_DIR is set', () => {
      process.env.SCREENSHOT_DIR = '/tmp/ss'
      const store = getScreenshotStore({ id: 'abc1234567', path: '/some/path' } as any)
      // Host store has resolvePath returning a string
      expect(store.resolvePath('abc1234567')).toBe('/tmp/ss/abc1234567-screenshot.png')
    })

    it('returns host store when app path basename is preview', () => {
      const store = getScreenshotStore({ id: 'abc1234567', path: '/tmp/apps/abc1234567/preview' } as any)
      expect(store.resolvePath('abc1234567')).toContain('agent')
    })

    it('returns workspace store when path is not preview and workspace available', () => {
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace())
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)
      // Workspace store returns null for resolvePath
      expect(store.resolvePath('abc1234567')).toBeNull()
    })

    it('falls back to host store when workspace unavailable', () => {
      mockedCreateForWorkspace.mockReturnValue(null)
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)
      // Falls back to host — resolvePath returns a string
      expect(store.resolvePath('abc1234567')).toBe('/data/apps/abc1234567/abc1234567-screenshot.png')
    })
  })

  describe('WorkspaceScreenshotStore', () => {
    it('write calls workspace.files.upload with correct path', async () => {
      const uploadFn = vi.fn().mockResolvedValue({ bytesWritten: 50 })
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace({ upload: uploadFn }))
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)

      const result = await store.write('abc1234567', Buffer.from('image-data'))

      expect(uploadFn).toHaveBeenCalledWith({ path: 'abc1234567-screenshot.png', data: Buffer.from('image-data') })
      expect(result.location).toBe('abc1234567-screenshot.png')
    })

    it('read calls workspace.files.download and returns buffer', async () => {
      const buf = Buffer.from('png-bytes')
      const downloadFn = vi.fn().mockResolvedValue({ data: buf })
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace({ download: downloadFn }))
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)

      const result = await store.read('abc1234567')

      expect(downloadFn).toHaveBeenCalledWith({ path: 'abc1234567-screenshot.png' })
      expect(result).toBe(buf)
    })

    it('exists returns true when stat entry has no error', async () => {
      const entry: StatEntry = { path: 'abc1234567-screenshot.png', kind: 'file', size: 100, modifiedAt: '2024-01-01' }
      const statFn = vi.fn().mockResolvedValue({ entries: [entry] })
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace({ stat: statFn }))
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)

      const result = await store.exists('abc1234567')

      expect(statFn).toHaveBeenCalledWith({ paths: ['abc1234567-screenshot.png'] })
      expect(result).toBe(true)
    })

    it('exists returns false when stat entry has error', async () => {
      const entry: StatEntry = { path: 'abc1234567-screenshot.png', error: 'not_found' }
      const statFn = vi.fn().mockResolvedValue({ entries: [entry] })
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace({ stat: statFn }))
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)

      const result = await store.exists('abc1234567')

      expect(result).toBe(false)
    })

    it('exists returns false when stat returns empty entries', async () => {
      const statFn = vi.fn().mockResolvedValue({ entries: [] })
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace({ stat: statFn }))
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)

      const result = await store.exists('abc1234567')

      expect(result).toBe(false)
    })

    it('resolvePath returns null', () => {
      mockedCreateForWorkspace.mockReturnValue(createMockWorkspace())
      const store = getScreenshotStore({ id: 'abc1234567', path: '/data/apps/abc1234567' } as any)
      expect(store.resolvePath('abc1234567')).toBeNull()
    })
  })

  describe('HostScreenshotStore path-traversal guard', () => {
    it('write rejects traversal in appId', async () => {
      process.env.SCREENSHOT_DIR = '/tmp/ss'
      const store = getScreenshotStore({ id: 'abc1234567', path: '/x' } as any)
      await expect(store.write('../etc/passwd', Buffer.from('x'))).rejects.toThrow(/escapes allowed directory/)
    })

    it('exists returns false for traversal appId', async () => {
      process.env.SCREENSHOT_DIR = '/tmp/ss'
      const store = getScreenshotStore({ id: 'abc1234567', path: '/x' } as any)
      const result = await store.exists('../etc/passwd')
      expect(result).toBe(false)
    })

    it('resolvePath returns null for traversal appId', () => {
      process.env.SCREENSHOT_DIR = '/tmp/ss'
      const store = getScreenshotStore({ id: 'abc1234567', path: '/x' } as any)
      expect(store.resolvePath('../etc/passwd')).toBeNull()
    })
  })
})
