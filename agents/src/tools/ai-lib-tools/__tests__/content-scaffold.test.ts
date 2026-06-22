import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { ScaffoldResult } from '../../content-scaffold.js'

// Hoisted mocks — declared before the vi.mock factories that reference them.
const {
  mockFindById,
  mockScaffoldContent,
  mockEnsureContentPluginRegistered,
  mockAtomicWrite,
  mockReadFile,
  mockUnlink,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockScaffoldContent: vi.fn(),
  mockEnsureContentPluginRegistered: vi.fn(),
  mockAtomicWrite: vi.fn(),
  mockReadFile: vi.fn(),
  mockUnlink: vi.fn(),
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById = mockFindById
  },
}))

vi.mock('../../content-scaffold.js', () => ({
  scaffoldContent: mockScaffoldContent,
  ensureContentPluginRegistered: mockEnsureContentPluginRegistered,
}))

vi.mock('../../../utils/fs-utils.js', () => ({
  atomicWrite: mockAtomicWrite,
}))

vi.mock('../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    unlink: mockUnlink,
  },
}))

// Import after mocks are defined.
import { contentScaffoldAITool } from '../content-scaffold.js'

const createContext = (metadata: Record<string, unknown>) => ({
  experimental_context: { metadata },
})

const okResult: ScaffoldResult = {
  ok: true,
  file: '/apps/app-1/src/content/pages/home.json',
  relFile: 'content/pages/home.json',
  importLine: "import { home } from 'virtual:content';",
  schemasCreated: true,
  key: 'home',
}

describe('contentScaffoldAITool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindById.mockReturnValue({ id: 'app-1', name: 'Test App', path: '/apps/app-1' })
    mockScaffoldContent.mockResolvedValue(okResult)
    mockEnsureContentPluginRegistered.mockReturnValue({ code: 'patched', modified: false })
    mockReadFile.mockResolvedValue('export default {}')
    mockUnlink.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))
  })

  it('resolves appId from context.metadata and computes contentDir from app.path', async () => {
    await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } } },
      createContext({ appId: 'app-1' }),
    )

    expect(mockFindById).toHaveBeenCalledWith('app-1')
    expect(mockScaffoldContent).toHaveBeenCalledWith(
      '/apps/app-1/src/content',
      expect.objectContaining({ kind: 'page', name: 'home' }),
    )
  })

  it('returns the scaffold projection on success', async () => {
    const result = await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } } },
      createContext({ appId: 'app-1' }),
    )

    expect(result).toEqual({
      success: true,
      file: 'content/pages/home.json',
      importLine: "import { home } from 'virtual:content';",
      key: 'home',
      schemasCreated: true,
      message: expect.stringContaining('Scaffolded page "home"'),
    })
  })

  it('passes mode through to scaffoldContent', async () => {
    await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } }, mode: 'replace' },
      createContext({ appId: 'app-1' }),
    )

    expect(mockScaffoldContent).toHaveBeenCalledWith(
      '/apps/app-1/src/content',
      expect.objectContaining({ mode: 'replace' }),
    )
  })

  it('defaults mode to undefined (merge) when not provided', async () => {
    await contentScaffoldAITool.execute(
      { kind: 'site', content: { brand: { name: 'Acme' } } },
      createContext({ appId: 'app-1' }),
    )

    expect(mockScaffoldContent).toHaveBeenCalledWith(
      '/apps/app-1/src/content',
      expect.objectContaining({ mode: undefined }),
    )
  })

  it('registers the vite content plugin when missing and writes it back', async () => {
    mockEnsureContentPluginRegistered.mockReturnValue({ code: 'patched-config', modified: true })

    await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } } },
      createContext({ appId: 'app-1' }),
    )

    expect(mockReadFile).toHaveBeenCalledWith('/apps/app-1/vite.config.ts', 'utf8')
    expect(mockEnsureContentPluginRegistered).toHaveBeenCalledWith('export default {}')
    expect(mockAtomicWrite).toHaveBeenCalledWith('/apps/app-1/vite.config.ts', 'patched-config')
  })

  it('does not write vite.config.ts when the plugin is already registered', async () => {
    mockEnsureContentPluginRegistered.mockReturnValue({ code: 'export default {}', modified: false })

    await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } } },
      createContext({ appId: 'app-1' }),
    )

    expect(mockAtomicWrite).not.toHaveBeenCalled()
  })

  it('attempts to remove the rogue barrel file (ignoring ENOENT)', async () => {
    await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } } },
      createContext({ appId: 'app-1' }),
    )

    expect(mockUnlink).toHaveBeenCalledWith('/apps/app-1/src/content/index.ts')
  })

  it('does not fail when a vite read error makes plugin registration non-fatal', async () => {
    mockReadFile.mockRejectedValue(new Error('no vite.config'))

    const result = await contentScaffoldAITool.execute(
      { kind: 'page', name: 'home', content: { hero: { title: 'Hi' } } },
      createContext({ appId: 'app-1' }),
    )

    expect((result as { success: boolean }).success).toBe(true)
    expect(mockAtomicWrite).not.toHaveBeenCalled()
  })

  it('throws [code] message when scaffoldContent rejects', async () => {
    mockScaffoldContent.mockResolvedValue({
      ok: false,
      error: { code: 'invalid-name', message: '"99" is not a valid content name.' },
    })

    await expect(
      contentScaffoldAITool.execute(
        { kind: 'page', name: 'bad', content: {} },
        createContext({ appId: 'app-1' }),
      ),
    ).rejects.toThrow('[invalid-name] "99" is not a valid content name.')
  })

  it('throws when no appId is present in context metadata', async () => {
    await expect(
      contentScaffoldAITool.execute(
        { kind: 'page', name: 'home', content: {} },
        createContext({}),
      ),
    ).rejects.toThrow(/appId/)
    expect(mockScaffoldContent).not.toHaveBeenCalled()
  })

  it('throws when the app is not found', async () => {
    mockFindById.mockReturnValue(null)

    await expect(
      contentScaffoldAITool.execute(
        { kind: 'page', name: 'home', content: {} },
        createContext({ appId: 'missing' }),
      ),
    ).rejects.toThrow("App 'missing' not found")
    expect(mockScaffoldContent).not.toHaveBeenCalled()
  })
})
