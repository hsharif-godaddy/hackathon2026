import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockView = vi.fn()
const mockWrite = vi.fn().mockResolvedValue({ bytesWritten: 100 })

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () { return {
    files: { view: mockView, write: mockWrite }
  }; })
}))
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }; })
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn(function (id: string) { return id === 'test-app' ? { path: '/test/app' } : undefined; })
  }; })
}))

const mockAppPlanExecute = vi.fn().mockResolvedValue({ success: true })

vi.mock('../../app-plan-tool.js', () => ({
  appPlanTool: {
    execute: (...args: any[]) => mockAppPlanExecute(...args)
  }
}))

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { name: 'mock-model' },
    modelName: 'mock-model'
  })
}))

vi.mock('@airo/ai-lib', () => ({
  generateTextWithTracking: vi.fn(),
  createTool: vi.fn(function (_desc: any, _schema: any, fn: any) { return { execute: fn }; }),
  createPromptBuilder: vi.fn(function () { return {
    file: vi.fn().mockReturnThis(),
    build: vi.fn().mockResolvedValue('test prompt')
  }; })
}))
vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: { getStore: vi.fn(), run: vi.fn(function (_meta: any, fn: any) { return fn(); }) }
}))
vi.mock('@airo/ai-grants', () => ({
  buildLitellmMetadataFromContext: vi.fn(),
  LlmCallSource: { ToolFontTheme: 'tool-font-theme' }
}))

const { fontThemeAITool } = await import('../font-theme.js')

const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
  body {
    font-family: var(--font-sans);
  }
}`

describe('font-theme persistence', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8', lines: 8, size: mockCss.length, truncated: false, path: 'src/styles/globals.css' })
    mockWrite.mockResolvedValue({ bytesWritten: 100 })
    mockAppPlanExecute.mockResolvedValue({ success: true })

    originalFetch = global.fetch
    global.fetch = vi.fn(function () { return Promise.resolve({ ok: true, status: 200 } as Response); }
    ) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('apply mode', () => {
    it('should persist font theme to app plan after CSS apply', async () => {
      const stateManager = {
        getSuggestedFont: vi.fn().mockReturnValue({
          name: 'Modern Roastery',
          headerFont: { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
          bodyFont: { name: 'Lato', weights: ['400', '500'], category: 'sans-serif' }
        })
      }

      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session',
          stateManager
        },
        messages: [{ role: 'user', content: 'Apply font theme: Modern Roastery' }]
      }

      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeName: 'Modern Roastery', count: 4 },
        context
      ) as any

      expect(result.success).toBe(true)
      expect(mockAppPlanExecute).toHaveBeenCalledWith({
        appId: 'test-app',
        operation: 'update',
        fontTheme: {
          name: 'Modern Roastery',
          headerFont: { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
          bodyFont: { name: 'Lato', weights: ['400', '500'], category: 'sans-serif' }
        }
      })
    })

    it('should still succeed when app plan save fails', async () => {
      mockAppPlanExecute.mockRejectedValue(new Error('DB write failed'))

      const stateManager = {
        getSuggestedFont: vi.fn().mockReturnValue({
          name: 'Test Theme',
          headerFont: { name: 'Inter', weights: ['400', '700'], category: 'sans-serif' },
          bodyFont: { name: 'Inter', weights: ['400', '700'], category: 'sans-serif' }
        })
      }

      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session',
          stateManager
        },
        messages: [{ role: 'user', content: 'Apply font theme: Test Theme' }]
      }

      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeName: 'Test Theme', count: 4 },
        context
      ) as any

      // CSS was still applied successfully
      expect(result.success).toBe(true)
      expect(mockWrite).toHaveBeenCalled()
    })

    it('should persist curated theme to app plan', async () => {
      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session'
        }
      }

      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeId: 'modern-professional', count: 4 },
        context
      ) as any

      expect(result.success).toBe(true)
      expect(mockAppPlanExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'test-app',
          operation: 'update',
          fontTheme: expect.objectContaining({
            name: 'Modern Professional',
            headerFont: expect.objectContaining({ name: 'Montserrat' }),
            bodyFont: expect.objectContaining({ name: 'Inter' })
          })
        })
      )
    })
  })
})
