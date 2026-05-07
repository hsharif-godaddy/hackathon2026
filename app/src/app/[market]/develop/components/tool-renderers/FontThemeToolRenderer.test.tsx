/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import FontThemeToolRenderer from './FontThemeToolRenderer'

// Mock useSwitchboard hook
const mockUseSwitchboard = vi.fn()
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

// Mock useTranslations hook
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: any, defaultValue?: string) => defaultValue || key,
}))

describe('FontThemeToolRenderer', () => {
  const mockFontThemeObjectFormat = {
    themeName: 'Modern Professional',
    appliedFont: {
      name: 'Modern Professional',
      headerFont: {
        name: 'Montserrat',
        weights: ['400', '600', '700'],
        category: 'sans-serif'
      },
      bodyFont: {
        name: 'Open Sans',
        weights: ['400', '500', '600'],
        category: 'sans-serif'
      }
    }
  }

  const mockFontThemeStringFormat = {
    themeName: 'Classic Serif',
    headerFont: 'Playfair Display',
    bodyFont: 'Lora'
  }

  const mockFontThemeSameFont = {
    themeName: 'Minimalist',
    headerFont: 'Inter',
    bodyFont: 'Inter'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Modern renderer (feature flag enabled)', () => {
    beforeEach(() => {
      mockUseSwitchboard.mockReturnValue(true)
    })

    describe('apply mode - completed', () => {
      it('should render FontPaletteWidget when mode is apply and status is completed (object format)', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply', themeName: 'Modern Professional' }}
            result={mockFontThemeObjectFormat}
          />
        )

        expect(screen.getByText('Modern Professional')).toBeInTheDocument()
        expect(screen.getByText('Montserrat')).toBeInTheDocument()
        expect(screen.getByText('Open Sans')).toBeInTheDocument()
      })

      it('should render FontPaletteWidget when mode is apply and status is completed (string format)', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply', themeName: 'Classic Serif' }}
            result={mockFontThemeStringFormat}
          />
        )

        expect(screen.getByText('Classic Serif')).toBeInTheDocument()
        expect(screen.getByText('Playfair Display')).toBeInTheDocument()
        expect(screen.getByText('Lora')).toBeInTheDocument()
      })

      it('should render FontPaletteWidget with same font (no duplication)', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply', themeName: 'Minimalist' }}
            result={mockFontThemeSameFont}
          />
        )

        expect(screen.getByText('Minimalist')).toBeInTheDocument()
        const interElements = screen.getAllByText('Inter')
        // Should only show font name once when they're the same
        expect(interElements).toHaveLength(1)
      })

      it('should use themeName from result over input', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply', themeName: 'Input Name' }}
            result={{ ...mockFontThemeStringFormat, themeName: 'Result Name' }}
          />
        )

        expect(screen.getByText('Result Name')).toBeInTheDocument()
        expect(screen.queryByText('Input Name')).not.toBeInTheDocument()
      })

      it('should use default theme name if not provided', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={{
              headerFont: 'Roboto',
              bodyFont: 'Lato'
            }}
          />
        )

        expect(screen.getByText('Font Theme')).toBeInTheDocument()
      })

      it('should render widget with mt-2 mb-2 spacing', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={mockFontThemeStringFormat}
          />
        )

        const wrapper = container.querySelector('.mt-2.mb-2')
        expect(wrapper).toBeInTheDocument()
      })
    })

    describe('set mode - completed', () => {
      it('should render FontPaletteWidget when mode is set and status is completed', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'set', headerFont: 'Montserrat', bodyFont: 'Open Sans' }}
            result={mockFontThemeObjectFormat}
          />
        )

        expect(screen.getByText('Modern Professional')).toBeInTheDocument()
        expect(screen.getByText('Montserrat')).toBeInTheDocument()
        expect(screen.getByText('Open Sans')).toBeInTheDocument()
      })

      it('should handle set mode with string format', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'set' }}
            result={mockFontThemeStringFormat}
          />
        )

        expect(screen.getByText('Classic Serif')).toBeInTheDocument()
        expect(screen.getByText('Playfair Display')).toBeInTheDocument()
      })
    })

    describe('apply/set mode - non-completed states', () => {
      it('should not render anything when status is pending', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="pending"
            input={{ mode: 'apply' }}
            result={mockFontThemeStringFormat}
          />
        )

        expect(container.firstChild).toBeNull()
      })

      it('should not render anything when status is running', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="running"
            input={{ mode: 'apply' }}
            result={mockFontThemeStringFormat}
          />
        )

        expect(container.firstChild).toBeNull()
      })

      it('should not render anything when status is failed', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="failed"
            input={{ mode: 'apply' }}
            result={mockFontThemeStringFormat}
          />
        )

        expect(container.firstChild).toBeNull()
      })
    })

    describe('suggest mode', () => {
      it('should not render anything for suggest mode', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'suggest' }}
            result={{
              themes: [
                { id: '1', name: 'Theme 1', headerFont: { name: 'Font A', weights: ['400'] }, bodyFont: { name: 'Font B', weights: ['400'] } },
                { id: '2', name: 'Theme 2', headerFont: { name: 'Font C', weights: ['400'] }, bodyFont: { name: 'Font D', weights: ['400'] } }
              ]
            }}
          />
        )

        expect(container.firstChild).toBeNull()
      })
    })

    describe('missing data', () => {
      it('should not render when headerFont is missing', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={{ themeName: 'Test', bodyFont: 'Roboto' }}
          />
        )

        expect(container.firstChild).toBeNull()
      })

      it('should not render when bodyFont is missing', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={{ themeName: 'Test', headerFont: 'Roboto' }}
          />
        )

        expect(container.firstChild).toBeNull()
      })

      it('should not render when result is null', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={null}
          />
        )

        expect(container.firstChild).toBeNull()
      })

      it('should not render when result is not an object', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result="invalid"
          />
        )

        expect(container.firstChild).toBeNull()
      })
    })

    describe('no mode specified', () => {
      it('should not render when mode is undefined', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{}}
            result={mockFontThemeStringFormat}
          />
        )

        expect(container.firstChild).toBeNull()
      })

      it('should not render when input is undefined', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={undefined}
            result={mockFontThemeStringFormat}
          />
        )

        expect(container.firstChild).toBeNull()
      })
    })

    describe('edge cases', () => {
      it('should handle empty themeName gracefully', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply', themeName: '' }}
            result={{ ...mockFontThemeStringFormat, themeName: '' }}
          />
        )

        expect(screen.getByText('Font Theme')).toBeInTheDocument()
      })

      it('should handle very long themeName', () => {
        const longName = 'A'.repeat(100)
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply', themeName: longName }}
            result={{ ...mockFontThemeStringFormat, themeName: longName }}
          />
        )

        expect(screen.getByText(longName)).toBeInTheDocument()
      })

      it('should handle legacy fontName format', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={{
              themeName: 'Legacy Theme',
              fontName: 'Roboto'
            }}
          />
        )

        expect(screen.getByText('Legacy Theme')).toBeInTheDocument()
        expect(screen.getByText('Roboto')).toBeInTheDocument()
      })

      it('should handle mixed object and string format', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={{
              themeName: 'Mixed Format',
              appliedFont: {
                headerFont: {
                  name: 'Montserrat',
                  weights: ['400', '700'],
                  category: 'sans-serif'
                }
              },
              bodyFont: 'Open Sans'
            }}
          />
        )

        expect(screen.getByText('Mixed Format')).toBeInTheDocument()
        expect(screen.getByText('Montserrat')).toBeInTheDocument()
        expect(screen.getByText('Open Sans')).toBeInTheDocument()
      })
    })
  })

  describe('Legacy renderer (feature flag disabled)', () => {
    beforeEach(() => {
      mockUseSwitchboard.mockReturnValue(false)
    })

    describe('suggest mode - completed', () => {
      it('should render FontThemeGridWidget when mode is suggest and status is completed', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'suggest' }}
            result={{
              themes: [
                {
                  id: '1',
                  name: 'Theme 1',
                  headerFont: { name: 'Font A', weights: ['400'] },
                  bodyFont: { name: 'Font B', weights: ['400'] }
                }
              ]
            }}
          />
        )

        // Legacy mode renders the grid widget for suggest mode
        expect(container.querySelector('.mt-2.mb-2')).toBeInTheDocument()
      })

      it('should show helper message for suggest mode', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'suggest' }}
            result={{
              themes: [
                {
                  id: '1',
                  name: 'Theme 1',
                  headerFont: { name: 'Font A', weights: ['400'] },
                  bodyFont: { name: 'Font B', weights: ['400'] }
                }
              ]
            }}
          />
        )

        expect(screen.getByText('Click a font to select, then Apply')).toBeInTheDocument()
      })
    })

    describe('apply mode - completed', () => {
      it('should render clickable card when mode is apply and status is completed', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={mockFontThemeObjectFormat}
          />
        )

        const button = container.querySelector('button')
        expect(button).toBeInTheDocument()
        expect(button).toHaveClass('w-full')
        // The fonts are displayed as a combined label "Font1 + Font2"
        expect(screen.getByText('Montserrat + Open Sans')).toBeInTheDocument()
      })

      it('should render "The quick brown fox" preview text', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={mockFontThemeObjectFormat}
          />
        )

        expect(screen.getByText('The quick brown fox jumps over the lazy dog')).toBeInTheDocument()
      })

      it('should handle same font in apply mode (no plus icon)', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{ mode: 'apply' }}
            result={{
              appliedFont: {
                headerFont: { name: 'Inter', weights: ['400', '700'], category: 'sans-serif' },
                bodyFont: { name: 'Inter', weights: ['400', '700'], category: 'sans-serif' }
              }
            }}
          />
        )

        const interElements = screen.getAllByText('Inter')
        // In legacy mode, both header and body are shown separately even if same
        expect(interElements.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('direct set mode (no suggest/apply)', () => {
      it('should render card matching ColorPaletteWidget style', () => {
        const { container } = renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="completed"
            input={{}}
            result={mockFontThemeObjectFormat}
          />
        )

        const button = container.querySelector('button')
        expect(button).toBeInTheDocument()
        expect(button).toHaveClass('hover:border-intents-ux-boxHighContrast-borderColor')
      })
    })

    describe('error handling', () => {
      it('should render error modal when status is error', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="error"
            input={{ mode: 'apply' }}
            result={null}
            error="Font not found"
          />
        )

        expect(screen.getByText('Font Theme')).toBeInTheDocument()
      })
    })

    describe('non-completed states', () => {
      it('should render header for pending status', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="pending"
            input={{ mode: 'apply' }}
            result={null}
          />
        )

        expect(screen.getByText('Font Theme')).toBeInTheDocument()
      })

      it('should render header for running status', () => {
        renderWithProviders(
          <FontThemeToolRenderer
            toolName="fontTheme"
            toolStatus="running"
            input={{ mode: 'apply' }}
            result={null}
          />
        )

        expect(screen.getByText('Font Theme')).toBeInTheDocument()
      })
    })
  })

  describe('Feature flag switching', () => {
    it('should switch between legacy and modern based on feature flag', () => {
      // Start with modern
      mockUseSwitchboard.mockReturnValue(true)
      const { rerender, container } = renderWithProviders(
        <FontThemeToolRenderer
          toolName="fontTheme"
          toolStatus="completed"
          input={{ mode: 'apply' }}
          result={mockFontThemeStringFormat}
        />
      )

      // Modern should not render suggest mode
      expect(screen.queryByText('Click a font to select, then Apply')).not.toBeInTheDocument()

      // Switch to legacy
      mockUseSwitchboard.mockReturnValue(false)
      rerender(
        <FontThemeToolRenderer
          toolName="fontTheme"
          toolStatus="completed"
          input={{ mode: 'suggest' }}
          result={{
            themes: [
              {
                id: '1',
                name: 'Theme 1',
                headerFont: { name: 'Font A', weights: ['400'] },
                bodyFont: { name: 'Font B', weights: ['400'] }
              }
            ]
          }}
        />
      )

      // Legacy should render suggest mode helper text
      expect(screen.getByText('Click a font to select, then Apply')).toBeInTheDocument()
    })
  })
})
