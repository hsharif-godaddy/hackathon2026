import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs/promises'

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  },
}))

const { mockFindById } = vi.hoisted(() => ({
  mockFindById: vi.fn(() => ({ id: 'app-1', path: '/tmp/app' })),
}))
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById = mockFindById
  },
}))

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}))

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn(),
}))

vi.mock('../../logging/index.js', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { logger: stub, Logger: { create: vi.fn(() => stub) } }
})

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {} }),
}))

vi.mock('../../tools/ast-image-editor.js', () => ({
  astImageEditor: { replaceImage: vi.fn().mockResolvedValue({ success: true }) },
}))

vi.mock('../GettyUploadService.js', () => ({
  gettyUploadService: { uploadAndReport: vi.fn().mockResolvedValue([]), reportUsage: vi.fn() },
}))

import { mediaManifestService } from '../MediaManifestService.js'

const slot = (currentUrl: string, mediaType = 'logo') => ({
  mediaType, currentUrl, alternatives: [], userModified: false,
  searchQuery: '', createdAt: 'now', lastUpdated: 'now',
})

/** writeManifest writes a .tmp file first, then renames, then mirrors a public copy.
 *  The .tmp write is the canonical manifest content. */
function readWrittenManifest(): Record<string, unknown> {
  const writeCall = vi.mocked(fs.writeFile).mock.calls.find(([p]) => String(p).endsWith('.tmp'))
  if (!writeCall) throw new Error('writeFile was not called for the manifest')
  return JSON.parse(String(writeCall[1])) as Record<string, unknown>
}

describe('MediaManifestService.removeSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindById.mockReturnValue({ id: 'app-1', path: '/tmp/app' })
  })

  it('removes the slot key and preserves others (skipGitCommit)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
      'logo/horizontal': slot('x'),
      'pages/home/hero': slot('y', 'image'),
    }))

    const res = await mediaManifestService.removeSlot('app-1', 'logo/horizontal', true)

    expect(res.success).toBe(true)
    const written = readWrittenManifest()
    expect(written['logo/horizontal']).toBeUndefined()
    expect(written['pages/home/hero']).toBeDefined()
  })

  it('returns success:true and no write when the slot is already absent', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'pages/home/hero': slot('y', 'image') }))
    const res = await mediaManifestService.removeSlot('app-1', 'logo/horizontal', true)
    expect(res.success).toBe(true)
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('returns an error when the app is not found', async () => {
    mockFindById.mockReturnValueOnce(undefined)
    const res = await mediaManifestService.removeSlot('app-1', 'logo/horizontal', true)
    expect(res.success).toBe(false)
    expect(res.error).toContain('App not found')
  })
})
