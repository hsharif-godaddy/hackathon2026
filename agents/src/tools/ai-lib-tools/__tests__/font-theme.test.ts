import { readFile, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises')
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }))
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn((id: string) => id === 'test-app' ? { path: '/test/app' } : undefined)
  }))
}))

// Import after mocks are set up
const { updateCssFontVariables, FONT_THEMES } = await import('../font-theme.js')

describe('font-theme', function packageTests() {
  describe('#updateCssFontVariables', function updateTests() {
    const mockAppPath = '/test/app'
    const mockCssPath = `${mockAppPath}/src/styles/globals.css`
    
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      const result = await updateCssFontVariables(mockAppPath, testFont, testFont)

      expect(result.success).toBe(true)
      expect(result.message).toContain('Inter')
      expect(writeFile).toHaveBeenCalledOnce()
    })

    it('should add Google Fonts import at the top', async function addGoogleFonts() {
      const mockCss = `@tailwind base;

@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }
}`

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      const importMatches = writtenContent.match(/@import url\('https:\/\/fonts\.googleapis\.com/g)
      expect(importMatches).toHaveLength(1) // Only the new import should exist
    })

    it('should update --font-sans variable', async function updateFontSans() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
  }
}`

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      expect(writtenContent).toContain(`--font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;`)
    })

    it('should update --font-heading variable if present', async function updateFontHeading() {
      const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: Georgia, serif;
  }
}`

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      expect(writtenContent).toContain('h1, h2, h3, h4, h5, h6')
      expect(writtenContent).toContain('font-family: var(--font-heading) !important')
    })

    it('should add missing font variables when not present', async function missingFontVariables() {
      const mockCss = `@layer base {
  :root {
    --color-primary: blue;
  }
}`

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      const result = await updateCssFontVariables(mockAppPath, testFont, testFont)

      expect(result.success).toBe(true)
      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      expect(writtenContent).toContain('--font-sans: "Inter"')
      expect(writtenContent).toContain('--font-heading: "Inter"')
    })

    it('should handle file read errors gracefully', async function handleReadError() {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const result = await updateCssFontVariables(mockAppPath, testFont, testFont)

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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockRejectedValue(new Error('EACCES: permission denied'))

      const result = await updateCssFontVariables(mockAppPath, testFont, testFont)

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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      // Test with serif and sans-serif themes
      const testThemes = ['modern-professional', 'elegant-serif']

      for (const themeId of testThemes) {
        vi.clearAllMocks()
        const theme = FONT_THEMES[themeId]
        const result = await updateCssFontVariables(mockAppPath, theme.headerFont, theme.bodyFont)

        expect(result.success).toBe(true)
        expect(result.message).toContain(theme.headerFont.name)

        const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      await updateCssFontVariables(mockAppPath, testFont, testFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

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

      const result = await updateCssFontVariables(mockAppPath, headerFont, bodyFont)

      expect(result.success).toBe(true)

      const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

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

      await updateCssFontVariables(mockAppPath, headerFont, bodyFont)

      const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string
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

      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()

      const { updateCssFontVariables } = await import('../font-theme.js')

      const font = {
        name: 'Inter',
        weights: ['400', '700'],
        category: 'sans-serif' as const,
      }

      await updateCssFontVariables(mockAppPath, font, font)

      const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string
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

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(readFile).mockResolvedValue(mockCss)
      vi.mocked(writeFile).mockResolvedValue()
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
        { experimental_context: context }
      ) as any

      expect(result.success).toBe(true)
      expect(result.themeName).toBe('Modern Roastery')
      const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string
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
        { experimental_context: context }
      ) as any

      expect(result.success).toBe(true)
      const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string
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
          { experimental_context: context }
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
})

