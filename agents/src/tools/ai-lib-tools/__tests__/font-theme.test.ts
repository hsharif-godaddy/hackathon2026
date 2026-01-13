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
    error: vi.fn()
  }
}))

// Import after mocks are set up
const { updateCssFontVariables, FONT_THEMES } = await import('../font-theme.js')

describe('font-theme', function packageTests() {
  describe('#updateCssFontVariables', function updateTests() {
    const mockAppPath = '/test/app'
    const mockCssPath = `${mockAppPath}/src/styles/globals.css`
    
    const testTheme = {
      name: 'Test Theme',
      description: 'Test font theme',
      font: {
        name: 'Inter',
        weights: ['400', '700'],
        category: 'sans-serif' as const,
        fallback: '-apple-system, BlinkMacSystemFont, sans-serif',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'
      }
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

      const result = await updateCssFontVariables(mockAppPath, testTheme)

      expect(result.success).toBe(true)
      expect(result.message).toContain('Test Theme')
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

      await updateCssFontVariables(mockAppPath, testTheme)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      expect(writtenContent).toMatch(/^@import url\('https:\/\/fonts\.googleapis\.com/)
      expect(writtenContent).toContain(testTheme.font.googleFontsUrl)
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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      expect(writtenContent).toContain('h1, h2, h3, h4, h5, h6')
      expect(writtenContent).toContain('font-family: var(--font-heading) !important')
    })

    it('should throw error when --font-sans variable is missing', async function missingFontSans() {
      const mockCss = `@layer base {
  :root {
    --color-primary: blue;
  }
}`

      vi.mocked(readFile).mockResolvedValue(mockCss)

      const result = await updateCssFontVariables(mockAppPath, testTheme)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Could not find --font-sans variable')
    })

    it('should handle file read errors gracefully', async function handleReadError() {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const result = await updateCssFontVariables(mockAppPath, testTheme)

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

      const result = await updateCssFontVariables(mockAppPath, testTheme)

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
        const result = await updateCssFontVariables(mockAppPath, theme)

        expect(result.success).toBe(true)
        expect(result.message).toContain(theme.name)
        
        const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
        expect(writtenContent).toContain(theme.font.name)
        expect(writtenContent).toContain(theme.font.googleFontsUrl)
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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

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

      await updateCssFontVariables(mockAppPath, testTheme)

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
      expect(writtenContent).toContain('font-family: var(--font-sans)')
      expect(writtenContent).not.toContain('Arial, Helvetica')
    })
  })
})

