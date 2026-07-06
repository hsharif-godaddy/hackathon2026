import { describe, it, expect, vi, beforeEach } from 'vitest'

// AIROBUILD-2665 / Fix B — colorScheme must not SILENTLY overwrite an attached
// kit's palette via automated 'set'. AIROBUILD-2976 — but an explicit customer
// request ('apply', i.e. the user selected or specified colors) is honored even
// when the kit is locked. When the kit's tokens are locked (forced-install applied
// them in code, marked via the designKitTokensLocked app-metadata flag): 'set'
// returns a "locked" result and writes nothing; 'apply' writes through; 'suggest'
// (preview only, no write) stays exempt; without the lock the writer runs as today.

const mockKitTokensLocked = vi.hoisted(() => vi.fn())
const mockUpdateCssColorPalette = vi.hoisted(() => vi.fn())
const mockGeneratePalette = vi.hoisted(() => vi.fn())
const mockGenerateTextWithTracking = vi.hoisted(() => vi.fn())
const mockFindById = vi.hoisted(() => vi.fn())

vi.mock('../../../services/design-system/kit-tokens-locked.js', () => ({
  kitTokensLocked: mockKitTokensLocked,
}))

vi.mock('../../css-color-tool.js', () => ({
  updateCssColorPalette: mockUpdateCssColorPalette,
  generatePalette: mockGeneratePalette,
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return { findById: mockFindById }
  }),
}))

vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock('../../app-plan-tool.js', () => ({
  appPlanTool: { execute: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({ model: { name: 'mock' }, modelName: 'mock' }),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-lib')>()
  return {
    ...actual,
    generateTextWithTracking: mockGenerateTextWithTracking,
    createTool: vi.fn((_desc, _schema, fn) => ({ execute: fn })),
  }
})

import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { createForWorkspace } from '../../../workspace/index.js'

const fullPalette = {
  primary: '#9333EA', primaryForeground: '#fff', secondary: '#64748b', secondaryForeground: '#fff',
  accent: '#8b5cf6', accentForeground: '#fff', background: '#fff', foreground: '#000',
  muted: '#eee', mutedForeground: '#666', border: '#ddd', card: '#fff', cardForeground: '#000',
  destructive: '#ef4444', destructiveForeground: '#fff', success: '#10b981', successForeground: '#fff',
  warning: '#f59e0b', warningForeground: '#fff', chart1: '#1', chart2: '#2', chart3: '#3', chart4: '#4', chart5: '#5',
  theme: 'light',
}

describe('colorScheme — kit lock (Fix B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({ view: vi.fn(), write: vi.fn(), readText: vi.fn().mockResolvedValue('') })
    } as any)
    mockFindById.mockReturnValue({ id: 'test-app', path: '/repo/test-app' })
    mockGeneratePalette.mockReturnValue(fullPalette)
    mockUpdateCssColorPalette.mockResolvedValue({ success: true, palette: fullPalette, message: 'ok' })
    mockGenerateTextWithTracking.mockResolvedValue({
      text: JSON.stringify({ palettes: [{ name: 'Vibrant', primary: '#9333EA', background: '#fff' }] }),
    })
  })

  describe('when the kit tokens are locked', () => {
    beforeEach(() => {
      mockKitTokensLocked.mockReturnValue(true)
    })

    it('apply mode honors an explicit customer request and writes (even when locked)', async () => {
      const { colorSchemeAITool } = await import('../color-scheme.js')
      const result = await (colorSchemeAITool as any).execute(
        { mode: 'apply', primary: '#123456' },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.skipped).toBeUndefined()
      expect(result.success).toBe(true)
      expect(mockUpdateCssColorPalette).toHaveBeenCalledTimes(1)
    })

    it('set mode returns the locked result and writes nothing', async () => {
      const { colorSchemeAITool } = await import('../color-scheme.js')
      const result = await (colorSchemeAITool as any).execute(
        { mode: 'set', description: 'warm purple' },
        { metadata: { appId: 'test-app' } },
      )
      expect(result).toMatchObject({ success: true, skipped: true })
      expect(result.message).toMatch(/attached design kit/i)
      expect(mockUpdateCssColorPalette).not.toHaveBeenCalled()
      // The lock returns BEFORE any LLM generation runs.
      expect(mockGenerateTextWithTracking).not.toHaveBeenCalled()
    })

    it('suggest mode is exempt (previews only, no write)', async () => {
      const { colorSchemeAITool } = await import('../color-scheme.js')
      const result = await (colorSchemeAITool as any).execute(
        { mode: 'suggest', description: 'purple', count: 2, theme: 'both' },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.skipped).toBeUndefined()
      expect(result.widget?.widgetType).toBe('color-palette-grid')
      expect(mockUpdateCssColorPalette).not.toHaveBeenCalled()
    })
  })

  describe('when the kit tokens are not locked', () => {
    beforeEach(() => {
      mockKitTokensLocked.mockReturnValue(false)
    })

    it('apply mode writes the palette as today', async () => {
      const { colorSchemeAITool } = await import('../color-scheme.js')
      const result = await (colorSchemeAITool as any).execute(
        { mode: 'apply', primary: '#123456' },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.skipped).toBeUndefined()
      expect(result.success).toBe(true)
      expect(mockUpdateCssColorPalette).toHaveBeenCalledTimes(1)
    })

    it('set mode writes the palette as today', async () => {
      const { colorSchemeAITool } = await import('../color-scheme.js')
      const result = await (colorSchemeAITool as any).execute(
        { mode: 'set', description: 'warm purple' },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.skipped).toBeUndefined()
      expect(result.success).toBe(true)
      expect(mockUpdateCssColorPalette).toHaveBeenCalledTimes(1)
    })

    it('suggest mode previews as today', async () => {
      const { colorSchemeAITool } = await import('../color-scheme.js')
      const result = await (colorSchemeAITool as any).execute(
        { mode: 'suggest', description: 'purple', count: 2, theme: 'both' },
        { metadata: { appId: 'test-app' } },
      )
      expect(result.widget?.widgetType).toBe('color-palette-grid')
      expect(mockUpdateCssColorPalette).not.toHaveBeenCalled()
    })
  })
})
