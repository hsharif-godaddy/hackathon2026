import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockView = vi.fn()
const mockWrite = vi.fn().mockResolvedValue({ bytesWritten: 100 })
const mockFiles = { view: mockView, write: mockWrite } as any

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () { return { files: mockFiles }; })
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

// Create mock functions that can be accessed from tests
const mockGenerateTextWithTracking = vi.fn()

// Mock model-selection to avoid needing API credentials
vi.mock('../../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { name: 'mock-model' },
    modelName: 'mock-model'
  })
}))

// Mock @airo/ai-lib for testing LLM generation
vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/ai-lib')>()
  return {
    ...actual,
    generateTextWithTracking: mockGenerateTextWithTracking,
    createTool: vi.fn(function (desc, schema, fn) { return { execute: fn }; }),
    createPromptBuilder: vi.fn(function () { return {
      file: vi.fn().mockReturnThis(),
      build: vi.fn().mockResolvedValue('test prompt')
    }; })
  }
})

// Import after mocks are set up
const { updateCssFontVariables, FONT_THEMES, clearFontValidationCache, validateAndFilterFonts } = await import('../font-theme.js')

describe('font-theme', function packageTests() {
  describe('#updateCssFontVariables', function updateTests() {
    const testFont = {
      name: 'Inter',
      weights: ['400', '700'],
      category: 'sans-serif' as const,
      fallback: '-apple-system, BlinkMacSystemFont, sans-serif',
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should successfully update CSS with font variables', async function updateVariables() {
      const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --font-sans: -apple-system, BlinkMacSystemFont, sans-serif;
    --font-heading: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  
  body {
    font-family: var(--font-sans);
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      const result = await updateCssFontVariables(mockFiles, testFont, testFont)

      expect(result.success).toBe(true)
      expect(result.message).toContain('Inter')
      expect(mockWrite).toHaveBeenCalledOnce()
    })

    it('should add Google Fonts import at the top', async function addGoogleFonts() {
      const mockCss = `@tailwind base;

@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toMatch(/^@import url\('https:\/\/fonts\.googleapis\.com/)
      expect(writtenContent).toContain('family=Inter')
    })

    it('should remove existing Google Fonts imports', async function removeOldImports() {
      const mockCss = `@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=OpenSans:wght@400;600&display=swap');

@tailwind base;

@layer base {
  :root {
    --font-sans: Roboto, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      const importMatches = writtenContent.match(/@import url\('https:\/\/fonts\.googleapis\.com/g)
      expect(importMatches).toHaveLength(1) // Only the new import should exist
    })

    it('should update --font-sans variable', async function updateFontSans() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain(`--font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;`)
    })

    it('should update --font-heading variable if present', async function updateFontHeading() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: Georgia, serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain(`--font-heading: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;`)
    })

    it('should add heading rules to @layer base', async function addHeadingRules() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }
  
  body {
    font-family: var(--font-sans);
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('h1, h2, h3, h4, h5, h6')
      expect(writtenContent).toContain('font-family: var(--font-heading) !important')
    })

    it('should add missing font variables when not present', async function missingFontVariables() {
      const mockCss = `@layer base {
  :root {
    --color-primary: blue;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      const result = await updateCssFontVariables(mockFiles, testFont, testFont)

      expect(result.success).toBe(true)
      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('--font-sans: "Inter"')
      expect(writtenContent).toContain('--font-heading: "Inter"')
    })

    it('should handle file read errors gracefully', async function handleReadError() {
      mockView.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const result = await updateCssFontVariables(mockFiles, testFont, testFont)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Failed to update fonts')
      expect(result.message).toContain('ENOENT')
    })

    it('should handle file write errors gracefully', async function handleWriteError() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockRejectedValue(new Error('EACCES: permission denied'))

      const result = await updateCssFontVariables(mockFiles, testFont, testFont)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Failed to update fonts')
      expect(result.message).toContain('EACCES')
    })

    it('should work with different font themes', async function testDifferentThemes() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
  
  body {
    font-family: var(--font-sans);
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      // Test with serif and sans-serif themes
      const testThemes = ['modern-professional', 'elegant-serif']

      for (const themeId of testThemes) {
        vi.clearAllMocks()
        const theme = FONT_THEMES[themeId]
        const result = await updateCssFontVariables(mockFiles, theme.headerFont, theme.bodyFont)

        expect(result.success).toBe(true)
        expect(result.message).toContain(theme.headerFont.name)

        const writtenContent = mockWrite.mock.calls[0][0].content as string
        expect(writtenContent).toContain(theme.headerFont.name)
        expect(writtenContent).toContain(theme.bodyFont.name)
      }
    })

    it('should preserve other CSS content', async function preserveContent() {
      const mockCss = `/* Custom styles */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --color-primary: #3b82f6;
    --font-sans: -apple-system, sans-serif;
    --spacing-md: 1rem;
  }
  
  body {
    font-family: var(--font-sans);
    background: var(--color-primary);
  }
}

@layer components {
  .btn {
    padding: var(--spacing-md);
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('/* Custom styles */')
      expect(writtenContent).toContain('--color-primary: #3b82f6')
      expect(writtenContent).toContain('--spacing-md: 1rem')
      expect(writtenContent).toContain('@layer components')
      expect(writtenContent).toContain('.btn')
    })

    it('should add missing --font-sans variable for old apps', async function addFontSans() {
      const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --color-primary: #000;
  }

  body {
    @apply bg-background text-foreground;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('--font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;')
      expect(writtenContent).toContain('--font-heading: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;')
    })

    it('should add missing --font-heading variable for old apps', async function addFontHeading() {
      const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }

  body {
    @apply bg-background text-foreground font-sans;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('--font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;')
      expect(writtenContent).toContain('--font-heading: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;')
    })

    it('should add font-family to body if missing', async function addBodyFontFamily() {
      const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }

  body {
    @apply bg-background text-foreground;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading) !important;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('body {')
      expect(writtenContent).toContain('font-family: var(--font-sans)')
    })

    it('should create complete font setup for apps with minimal CSS', async function completeSetup() {
      const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --color-primary: #000;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('--font-sans: "Inter"')
      expect(writtenContent).toContain('--font-heading: "Inter"')
      expect(writtenContent).toContain('body {')
      expect(writtenContent).toContain('font-family: var(--font-sans)')
      expect(writtenContent).toContain('h1, h2, h3, h4, h5, h6 {')
      expect(writtenContent).toContain('font-family: var(--font-heading) !important')
    })

    it('should replace existing body font-family with variable', async function replaceBodyFont() {
      const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }

  body {
    @apply bg-background text-foreground;
    font-family: Arial, Helvetica, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      await updateCssFontVariables(mockFiles, testFont, testFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('font-family: var(--font-sans)')
      expect(writtenContent).not.toContain('Arial, Helvetica')
    })
  })

  describe('FONT_THEMES curated themes', function curatedTests() {
    it('should have headerFont and bodyFont for all curated themes', async function allThemesHavePairings() {
      const { FONT_THEMES } = await import('../font-theme.js')

      for (const [themeId, theme] of Object.entries(FONT_THEMES)) {
        expect(theme.headerFont, `${themeId} missing headerFont`).toBeDefined()
        expect(theme.bodyFont, `${themeId} missing bodyFont`).toBeDefined()
        expect(theme.headerFont.name, `${themeId} headerFont missing name`).toBeTruthy()
        expect(theme.bodyFont.name, `${themeId} bodyFont missing name`).toBeTruthy()
      }
    })
  })

  describe('#buildGoogleFontsUrl', function urlTests() {
    it('should build URL with multiple font families', async function multipleFonts() {
      const { buildGoogleFontsUrl } = await import('../font-theme.js')

      const fonts = [
        { name: 'Playfair Display', weights: ['600', '700'] },
        { name: 'Inter', weights: ['400', '500'] }
      ]

      const url = buildGoogleFontsUrl(fonts)

      expect(url).toContain('family=Playfair+Display:wght@600;700')
      expect(url).toContain('family=Inter:wght@400;500')
      expect(url).toContain('&display=swap')
    })

    it('should deduplicate when header and body fonts are the same', async function deduplicateSame() {
      const { buildGoogleFontsUrl } = await import('../font-theme.js')

      const fonts = [
        { name: 'Inter', weights: ['400', '700'] },
        { name: 'Inter', weights: ['400', '700'] }
      ]

      const url = buildGoogleFontsUrl(fonts)

      // Should only have one family parameter
      const familyMatches = url.match(/family=/g)
      expect(familyMatches).toHaveLength(1)
    })

    it('should merge weights when same font has different weights', async function mergeWeights() {
      const { buildGoogleFontsUrl } = await import('../font-theme.js')

      const fonts = [
        { name: 'Inter', weights: ['600', '700'] },
        { name: 'Inter', weights: ['400', '500'] }
      ]

      const url = buildGoogleFontsUrl(fonts)

      // Should merge all weights into one family
      expect(url).toContain('Inter:wght@400;500;600;700')
      const familyMatches = url.match(/family=/g)
      expect(familyMatches).toHaveLength(1)
    })
  })

  describe('#updateCssFontVariables with font pairings', function pairingTests() {
    const mockAppPath = '/test/app'

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should set different fonts for heading and body', async function differentFonts() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }

  body {
    font-family: var(--font-sans);
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      const { updateCssFontVariables } = await import('../font-theme.js')

      const headerFont = {
        name: 'Playfair Display',
        weights: ['600', '700'],
        category: 'serif' as const,
      }
      const bodyFont = {
        name: 'Inter',
        weights: ['400', '500'],
        category: 'sans-serif' as const,
      }

      const result = await updateCssFontVariables(mockFiles, headerFont, bodyFont)

      expect(result.success).toBe(true)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('--font-heading: "Playfair Display"')
      expect(writtenContent).toContain('--font-sans: "Inter"')
    })

    it('should import both fonts from Google Fonts', async function importBothFonts() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      const { updateCssFontVariables } = await import('../font-theme.js')

      const headerFont = {
        name: 'Playfair Display',
        weights: ['600', '700'],
        category: 'serif' as const,
      }
      const bodyFont = {
        name: 'Inter',
        weights: ['400', '500'],
        category: 'sans-serif' as const,
      }

      await updateCssFontVariables(mockFiles, headerFont, bodyFont)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('Playfair+Display')
      expect(writtenContent).toContain('Inter')
    })

    it('should deduplicate Google Fonts import when same font for header and body', async function deduplicateImport() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
}`

      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      const { updateCssFontVariables } = await import('../font-theme.js')

      const font = {
        name: 'Inter',
        weights: ['400', '700'],
        category: 'sans-serif' as const,
      }

      await updateCssFontVariables(mockFiles, font, font)

      const writtenContent = mockWrite.mock.calls[0][0].content as string
      // Should only have one family parameter
      const familyMatches = writtenContent.match(/family=Inter/g)
      expect(familyMatches).toHaveLength(1)
    })
  })

  describe('apply mode session restore', function applySessionTests() {
    const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
  body {
    font-family: var(--font-sans);
  }
}`
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      vi.clearAllMocks()
      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      // Mock fetch to return success for all Google Fonts validation requests
      originalFetch = global.fetch
      global.fetch = vi.fn(function () { return Promise.resolve({ ok: true, status: 200 } as Response); }
      ) as any
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should apply fonts from session using headerFont/bodyFont format', async function applyNewFormat() {
      const { fontThemeAITool } = await import('../font-theme.js')

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
      expect(result.themeName).toBe('Modern Roastery')
      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('"Merriweather"')
      expect(writtenContent).toContain('"Lato"')
    })

    it('should apply fonts from session using legacy fontName/weights format', async function applyLegacyFormat() {
      const { fontThemeAITool } = await import('../font-theme.js')

      const stateManager = {
        getSuggestedFont: vi.fn().mockReturnValue({
          name: 'Classic Serif',
          fontName: 'Georgia',
          weights: ['400', '700'],
          category: 'serif'
        })
      }

      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session',
          stateManager
        },
        messages: [{ role: 'user', content: 'Apply font theme: Classic Serif' }]
      }

      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeName: 'Classic Serif', count: 4 },
        context
      ) as any

      expect(result.success).toBe(true)
      const writtenContent = mockWrite.mock.calls[0][0].content as string
      expect(writtenContent).toContain('"Georgia"')
    })

    it('should throw when session font has neither format', async function applyInvalidData() {
      const { fontThemeAITool } = await import('../font-theme.js')

      const stateManager = {
        getSuggestedFont: vi.fn().mockReturnValue({
          name: 'Bad Theme'
          // Missing both headerFont/bodyFont and fontName/weights
        })
      }

      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session',
          stateManager
        },
        messages: [{ role: 'user', content: 'Apply font theme: Bad Theme' }]
      }

      await expect(
        (fontThemeAITool as any).execute(
          { mode: 'apply', themeName: 'Bad Theme', count: 4 },
          context
        )
      ).rejects.toThrow('found in session but has invalid data')
    })
  })

  describe('#normalizeFontTheme', function normalizeTests() {
    it('should return headerFont and bodyFont when both are present', async function bothPresent() {
      const { normalizeFontTheme } = await import('../font-theme.js')

      const theme = {
        id: 'test',
        name: 'Test Theme',
        description: 'Test',
        headerFont: {
          name: 'Playfair Display',
          weights: ['600', '700'],
          category: 'serif' as const,
        },
        bodyFont: {
          name: 'Inter',
          weights: ['400', '500'],
          category: 'sans-serif' as const,
        },
      }

      const result = normalizeFontTheme(theme)

      expect(result.headerFont.name).toBe('Playfair Display')
      expect(result.bodyFont.name).toBe('Inter')
    })

    it('should use legacy font field for both when headerFont/bodyFont missing', async function legacyFallback() {
      const { normalizeFontTheme } = await import('../font-theme.js')

      const theme = {
        id: 'test',
        name: 'Test Theme',
        description: 'Test',
        font: {
          name: 'Inter',
          weights: ['400', '700'],
          category: 'sans-serif' as const,
        },
      }

      const result = normalizeFontTheme(theme)

      expect(result.headerFont.name).toBe('Inter')
      expect(result.bodyFont.name).toBe('Inter')
    })
  })

  // Note: HTTP validation filtering for LLM-generated fonts is not tested here
  // because it requires mocking the LLM, which doesn't work reliably in CI.
  // The validation logic is tested indirectly via:
  // - Curated theme tests (verify validation is skipped)
  // - Session-restored theme tests (verify validation is performed)

  describe('curated theme validation', function curatedThemeTests() {
    const mockCss = `@layer base { :root { --font-sans: sans-serif; } }`
    let fetchCallCount = 0
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      vi.clearAllMocks()
      clearFontValidationCache() // Prevent cache pollution from other tests
      mockView.mockResolvedValue({ content: mockCss, encoding: 'utf-8' })
      mockWrite.mockResolvedValue({ bytesWritten: 100 })

      fetchCallCount = 0
      originalFetch = global.fetch
      // Track fetch calls
      global.fetch = vi.fn(function () {
        fetchCallCount++
        return Promise.resolve({ ok: true, status: 200 } as Response)
      }) as any
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should skip HTTP validation for curated themes', async function skipValidationForCurated() {
      const { fontThemeAITool } = await import('../font-theme.js')

      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session'
        }
      }

      // Apply a curated theme
      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeId: 'modern-professional', count: 4 },
        context
      ) as any

      expect(result.success).toBe(true)
      // Verify NO fetch calls were made (curated themes skip validation)
      expect(fetchCallCount).toBe(0)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should validate session-restored themes', async function validateSessionThemes() {
      const { fontThemeAITool } = await import('../font-theme.js')

      const stateManager = {
        getSuggestedFont: vi.fn().mockReturnValue({
          name: 'Custom Theme',
          headerFont: { name: 'Custom Font', weights: ['600', '700'], category: 'sans-serif' },
          bodyFont: { name: 'Custom Font', weights: ['400', '500'], category: 'sans-serif' }
        })
      }

      const context = {
        metadata: {
          appId: 'test-app',
          sessionId: 'test-session',
          stateManager
        },
        messages: [{ role: 'user', content: 'Apply font theme: Custom Theme' }]
      }

      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeName: 'Custom Theme', count: 4 },
        context
      ) as any

      expect(result.success).toBe(true)
      // Verify fetch WAS called (session themes need validation)
      expect(fetchCallCount).toBeGreaterThan(0)
    })
  })

  describe('#validateAndFilterFonts', function validateFilterTests() {
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      vi.clearAllMocks()
      clearFontValidationCache()
      originalFetch = global.fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should filter out invalid fonts based on HTTP 400 responses', async function filterInvalid() {
      const fonts = [
        {
          id: 'valid-font',
          name: 'Valid Font',
          description: 'A valid font',
          headerFont: { name: 'Inter', weights: ['600', '700'], category: 'sans-serif' as const },
          bodyFont: { name: 'Roboto', weights: ['400', '500'], category: 'sans-serif' as const }
        },
        {
          id: 'invalid-font',
          name: 'Invalid Font',
          description: 'An invalid font',
          headerFont: { name: 'Nova Classe', weights: ['600', '700'], category: 'serif' as const },
          bodyFont: { name: 'Fake Font', weights: ['400', '500'], category: 'sans-serif' as const }
        }
      ]

      // Mock fetch: 200 for Inter+Roboto, 400 for Nova Classe/Fake Font
      global.fetch = vi.fn(function (url: string | URL) {
        const urlStr = url.toString()
        if (urlStr.includes('Inter') && urlStr.includes('Roboto')) {
          return Promise.resolve({ ok: true, status: 200 } as Response)
        }
        if (urlStr.includes('Nova+Classe') || urlStr.includes('Fake+Font')) {
          return Promise.resolve({ ok: false, status: 400 } as Response)
        }
        return Promise.resolve({ ok: true, status: 200 } as Response)
      }) as any

      const result = await validateAndFilterFonts(fonts)

      expect(result).toHaveLength(1)
      expect(result[0]!.headerFont.name).toBe('Inter')
      expect(result[0]!.bodyFont.name).toBe('Roboto')
      expect(result[0]!.name).toBe('Valid Font')
    })

    it('accepts a single-weight font by clamping the requested weight (AIROBUILD-2481)', async function singleWeightAccepted() {
      // Bebas Neue ships only 400; an over-broad ['400','700'] request would 400
      // the whole stylesheet and get the font rejected. The clamp drops the 700
      // before validation so the (valid) font is accepted.
      const fonts = [
        {
          id: 'bebas',
          name: 'Bebas + Inter',
          description: 'Single-weight display heading',
          headerFont: { name: 'Bebas Neue', weights: ['400', '700'], category: 'sans-serif' as const },
          bodyFont: { name: 'Inter', weights: ['400'], category: 'sans-serif' as const }
        }
      ]

      // Simulate Google Fonts: requesting Bebas Neue at 700 (a weight it lacks) 400s.
      global.fetch = vi.fn(function (url: string | URL) {
        const bebasAt700 = /Bebas\+Neue:wght@[^&]*700/.test(url.toString())
        return Promise.resolve({ ok: !bebasAt700, status: bebasAt700 ? 400 : 200 } as Response)
      }) as any

      const result = await validateAndFilterFonts(fonts)

      expect(result).toHaveLength(1)
      expect(result[0]!.headerFont.name).toBe('Bebas Neue')
    })

    it('should distinguish network errors (5xx) from invalid fonts (400)', async function networkVsValidation() {
      const fonts = [
        {
          id: 'network-error-font',
          name: 'Network Error Font',
          description: 'Font with network error',
          headerFont: { name: 'Network Font', weights: ['600', '700'], category: 'sans-serif' as const },
          bodyFont: { name: 'Network Font', weights: ['400', '500'], category: 'sans-serif' as const }
        },
        {
          id: 'invalid-font',
          name: 'Invalid Font',
          description: 'Font that doesnt exist',
          headerFont: { name: 'Invalid Font', weights: ['600', '700'], category: 'serif' as const },
          bodyFont: { name: 'Invalid Font', weights: ['400', '500'], category: 'serif' as const }
        }
      ]

      // Mock fetch: 503 for Network Font (network error), 400 for Invalid Font
      global.fetch = vi.fn(function (url: string | URL) {
        const urlStr = url.toString()
        if (urlStr.includes('Network+Font')) {
          return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
        }
        if (urlStr.includes('Invalid+Font')) {
          return Promise.resolve({ ok: false, status: 400, statusText: 'Bad Request' } as Response)
        }
        return Promise.resolve({ ok: true, status: 200 } as Response)
      }) as any

      // Both should be filtered, but for different reasons
      await expect(validateAndFilterFonts(fonts)).rejects.toThrow(
        /Some fonts could not be validated due to network errors/
      )

      // Verify fetch was called for both fonts
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should throw network error message when all fonts fail with network errors', async function allNetworkErrors() {
      const fonts = [
        {
          id: 'font1',
          name: 'Font 1',
          description: 'Font 1',
          headerFont: { name: 'Font1', weights: ['600'], category: 'sans-serif' as const },
          bodyFont: { name: 'Font1', weights: ['400'], category: 'sans-serif' as const }
        },
        {
          id: 'font2',
          name: 'Font 2',
          description: 'Font 2',
          headerFont: { name: 'Font2', weights: ['600'], category: 'serif' as const },
          bodyFont: { name: 'Font2', weights: ['400'], category: 'serif' as const }
        }
      ]

      global.fetch = vi.fn(function () {
        return Promise.resolve({ ok: false, status: 503 } as Response)
      }) as any

      await expect(validateAndFilterFonts(fonts)).rejects.toThrow(
        /Could not validate fonts due to network errors/
      )
    })

    it('should throw validation error message when all fonts fail validation', async function allValidationErrors() {
      const fonts = [
        {
          id: 'font1',
          name: 'Font 1',
          description: 'Font 1',
          headerFont: { name: 'Font1', weights: ['600'], category: 'sans-serif' as const },
          bodyFont: { name: 'Font1', weights: ['400'], category: 'sans-serif' as const }
        },
        {
          id: 'font2',
          name: 'Font 2',
          description: 'Font 2',
          headerFont: { name: 'Font2', weights: ['600'], category: 'serif' as const },
          bodyFont: { name: 'Font2', weights: ['400'], category: 'serif' as const }
        }
      ]

      global.fetch = vi.fn(function () {
        return Promise.resolve({ ok: false, status: 400 } as Response)
      }) as any

      await expect(validateAndFilterFonts(fonts)).rejects.toThrow(
        /do not exist on Google Fonts or use unsupported weights/
      )
    })

    it('should use cache to avoid redundant HTTP calls', async function useCache() {
      const fonts = [
        {
          id: 'font1',
          name: 'Font 1',
          description: 'Font 1',
          headerFont: { name: 'Inter', weights: ['600', '700'], category: 'sans-serif' as const },
          bodyFont: { name: 'Roboto', weights: ['400', '500'], category: 'sans-serif' as const }
        }
      ]

      global.fetch = vi.fn(function () {
        return Promise.resolve({ ok: true, status: 200 } as Response)
      }) as any

      // First call: should fetch
      await validateAndFilterFonts(fonts)
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Second call: should use cache
      await validateAndFilterFonts(fonts)
      expect(global.fetch).toHaveBeenCalledTimes(1) // No additional fetch
    })

    it('should not cache network errors', async function noCacheNetworkErrors() {
      const fonts = [
        {
          id: 'font1',
          name: 'Font 1',
          description: 'Font 1',
          headerFont: { name: 'Inter', weights: ['600'], category: 'sans-serif' as const },
          bodyFont: { name: 'Roboto', weights: ['400'], category: 'sans-serif' as const }
        }
      ]

      global.fetch = vi.fn(function () {
        return Promise.resolve({ ok: false, status: 503 } as Response)
      }) as any

      // First call: network error
      await expect(validateAndFilterFonts(fonts)).rejects.toThrow()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Second call: should retry (network errors not cached)
      await expect(validateAndFilterFonts(fonts)).rejects.toThrow()
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('rebuild flow gating', function rebuildGating() {
    it('rejects set mode when isRebuildFlow is true', async function blockSet() {
      const { fontThemeAITool } = await import('../font-theme.js');

      await expect(
        (fontThemeAITool as any).execute(
          { mode: 'set', description: 'elegant serif for editorial site' },
          { metadata: { appId: 'app1234567', isRebuildFlow: true } },
        ),
      ).rejects.toThrow(/cannot change fonts during a website rebuild/i);
    });

    it('skips apply mode during rebuild with a user-facing message', async function skipApply() {
      const { fontThemeAITool } = await import('../font-theme.js');

      const result = await (fontThemeAITool as any).execute(
        { mode: 'apply', themeName: 'Modern Professional' },
        { metadata: { appId: 'app1234567', isRebuildFlow: true, sessionId: 's1', stateManager: {} } },
      );

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.message).toMatch(/already set from your site rebuild/i);
    });

    it('skips suggest mode during rebuild', async function skipSuggest() {
      const { fontThemeAITool } = await import('../font-theme.js');

      const result = await (fontThemeAITool as any).execute(
        { mode: 'suggest', count: 4 },
        { metadata: { appId: 'app1234567', isRebuildFlow: true } },
      );

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.message).toMatch(/already set from your site rebuild/i);
      expect(result.widget).toBeUndefined();
    });
  });
})



