import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// AIROBUILD-2665 / Fix B — fontTheme must NOT overwrite an attached kit's typography.
// When the kit's tokens are locked (forced-install applied them in code, marked
// via the designKitTokensLocked app-metadata flag), set/apply return a "locked"
// result and write nothing; suggest (preview only) stays exempt; without the lock
// the writer runs as today.

const mockKitTokensLocked = vi.hoisted(() => vi.fn())
const mockView = vi.fn()
const mockReadText = vi.fn().mockResolvedValue('')
const mockWrite = vi.fn().mockResolvedValue({ bytesWritten: 100 })
const mockGenerateTextWithTracking = vi.fn()

vi.mock('../../../services/design-system/kit-tokens-locked.js', () => ({
  kitTokensLocked: mockKitTokensLocked,
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return { findById: vi.fn((id: string) => (id === 'test-app' ? { path: '/test/app' } : undefined)) }
  }),
}))

vi.mock('../../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({ model: { name: 'mock-model' }, modelName: 'mock-model' }),
}))

vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-lib')>()
  return {
    ...actual,
    generateTextWithTracking: mockGenerateTextWithTracking,
    createTool: vi.fn(function (_desc, _schema, fn) { return { execute: fn } }),
    createPromptBuilder: vi.fn(function () {
      return { file: vi.fn().mockReturnThis(), build: vi.fn().mockResolvedValue('test prompt') }
    }),
  }
})

import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { createForWorkspace } from '../../../workspace/index.js'

const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
  body { font-family: var(--font-sans); }
}`

describe('fontTheme — kit lock (Fix B)', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({ view: mockView, write: mockWrite, readText: mockReadText })
    } as any)
    mockReadText.mockResolvedValue(mockCss)
    mockWrite.mockResolvedValue({ bytesWritten: 100 })
    originalFetch = global.fetch
    // Google Fonts validation: accept everything so the unlocked path can write.
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response)) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('when the kit tokens are locked', () => {
    beforeEach(() => {
      mockKitTokensLocked.mockReturnValue(true)
    })

    it('set mode returns the locked result and writes nothing', async () => {
      const { fontThemeAITool } = await import('../font-theme.js')
      const result = await (fontThemeAITool as any).execute(
        {
          mode: 'set',
          headerFont: { name: 'Merriweather', weights: ['700'], category: 'serif' },
          bodyFont: { name: 'Lato', weights: ['400'], category: 'sans-serif' },
        },
        { metadata: { appId: 'test-app' } },
      )
      expect(result).toMatchObject({ success: true, skipped: true })
      expect(result.message).toMatch(/attached design kit/i)
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('apply mode returns the locked result and writes nothing', async () => {
      const { fontThemeAITool } = await import('../font-theme.js')
      const result = await (fontThemeAITool as any).execute(
        {
          mode: 'apply',
          headerFont: { name: 'Playfair Display', weights: ['700'], category: 'serif' },
          bodyFont: { name: 'Source Sans 3', weights: ['400'], category: 'sans-serif' },
        },
        { metadata: { appId: 'test-app' } },
      )
      expect(result).toMatchObject({ success: true, skipped: true })
      expect(result.message).toMatch(/attached design kit/i)
      expect(mockWrite).not.toHaveBeenCalled()
    })

    it('suggest mode is exempt (curated previews, no write)', async () => {
      const { fontThemeAITool } = await import('../font-theme.js')
      const result = await (fontThemeAITool as any).execute(
        { mode: 'suggest', count: 4 },
        { metadata: { appId: 'test-app' } },
      )
      // Not the kit-locked shape — it returns the curated themes widget.
      expect(result.message).not.toMatch(/attached design kit/i)
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })

  describe('when the kit tokens are not locked', () => {
    beforeEach(() => {
      mockKitTokensLocked.mockReturnValue(false)
    })

    it('set mode writes the fonts as today', async () => {
      const { fontThemeAITool } = await import('../font-theme.js')
      const result = await (fontThemeAITool as any).execute(
        {
          mode: 'set',
          headerFont: { name: 'Merriweather', weights: ['700'], category: 'serif' },
          bodyFont: { name: 'Lato', weights: ['400'], category: 'sans-serif' },
        },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.skipped).toBeUndefined()
      expect(result.success).toBe(true)
      expect(mockWrite).toHaveBeenCalled()
    })

    it('apply mode writes the fonts as today', async () => {
      const { fontThemeAITool } = await import('../font-theme.js')
      const result = await (fontThemeAITool as any).execute(
        {
          mode: 'apply',
          headerFont: { name: 'Playfair Display', weights: ['700'], category: 'serif' },
          bodyFont: { name: 'Source Sans 3', weights: ['400'], category: 'sans-serif' },
        },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.skipped).toBeUndefined()
      expect(result.success).toBe(true)
      expect(mockWrite).toHaveBeenCalled()
    })
  })
})
