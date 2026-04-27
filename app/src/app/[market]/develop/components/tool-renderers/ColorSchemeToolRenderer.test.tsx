/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import { renderWithProviders } from '@/tests/test-utils'
import ColorSchemeToolRenderer from './ColorSchemeToolRenderer'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((flag: string) => {
    if (flag === 'airo-builder-theme-selection-chat') {
      return { data: true, isLoading: false, error: null }
    }
    return { data: false, isLoading: false, error: null }
  }),
}))

describe('ColorSchemeToolRenderer', () => {
  const mockPalette: CompletePalette = {
    primary: '#3b82f6',
    primaryForeground: '#ffffff',
    secondary: '#64748b',
    secondaryForeground: '#ffffff',
    accent: '#8b5cf6',
    accentForeground: '#ffffff',
    background: '#ffffff',
    foreground: '#0f172a',
    muted: '#f1f5f9',
    mutedForeground: '#64748b',
    border: '#e2e8f0',
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',
    success: '#10b981',
    successForeground: '#ffffff',
    warning: '#f59e0b',
    warningForeground: '#ffffff',
    chart1: '#3b82f6',
    chart2: '#8b5cf6',
    chart3: '#10b981',
    chart4: '#f59e0b',
    chart5: '#ef4444'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('apply mode - completed', () => {
    it('should render ColorPaletteWidget when mode is apply and status is completed', () => {
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Ocean Blue' }}
          result={{ palette: mockPalette, paletteName: 'Ocean Blue' }}
        />
      )

      expect(screen.getByTestId('color-palette-option')).toBeInTheDocument()
      expect(screen.getByText('Ocean Blue')).toBeInTheDocument()
    })

    it('should use paletteName from result over input', () => {
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Input Name' }}
          result={{ palette: mockPalette, paletteName: 'Result Name' }}
        />
      )

      expect(screen.getByText('Result Name')).toBeInTheDocument()
      expect(screen.queryByText('Input Name')).not.toBeInTheDocument()
    })

    it('should use paletteName from input if not in result', () => {
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Input Name' }}
          result={{ palette: mockPalette }}
        />
      )

      expect(screen.getByText('Input Name')).toBeInTheDocument()
    })

    it('should use default name if no paletteName provided', () => {
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply' }}
          result={{ palette: mockPalette }}
        />
      )

      expect(screen.getByText('Color Scheme')).toBeInTheDocument()
    })

    it('should render widget as readOnly', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Test' }}
          result={{ palette: mockPalette }}
        />
      )

      const widget = screen.getByTestId('color-palette-option')
      expect(widget.tagName).toBe('DIV')
      expect(container.querySelector('button')).not.toBeInTheDocument()
    })

    it('should render widget with mt-2 mb-2 spacing', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Test' }}
          result={{ palette: mockPalette }}
        />
      )

      const wrapper = container.querySelector('.mt-2.mb-2')
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('apply mode - non-completed states', () => {
    it('should not render anything when status is pending', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="pending"
          input={{ mode: 'apply', paletteName: 'Test' }}
          result={{ palette: mockPalette }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render anything when status is running', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="running"
          input={{ mode: 'apply', paletteName: 'Test' }}
          result={{ palette: mockPalette }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render anything when status is failed', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="failed"
          input={{ mode: 'apply', paletteName: 'Test' }}
          result={{ palette: mockPalette }}
        />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('suggest mode', () => {
    it('should not render anything for suggest mode', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'suggest' }}
          result={{
            palettes: [
              { name: 'Theme 1', palette: mockPalette },
              { name: 'Theme 2', palette: mockPalette }
            ]
          }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render anything for suggest mode even when completed', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'suggest' }}
          result={{ palettes: [] }}
        />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('missing data', () => {
    it('should not render when palette is missing', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply' }}
          result={{ paletteName: 'Test' }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render when palette is null', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply' }}
          result={{ palette: null }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render when palette is not an object', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply' }}
          result={{ palette: 'invalid' }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render when result is null', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply' }}
          result={null}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render when result is not an object', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
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
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{}}
          result={{ palette: mockPalette }}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should not render when input is undefined', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={undefined}
          result={{ palette: mockPalette }}
        />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should handle empty paletteName gracefully', () => {
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: '' }}
          result={{ palette: mockPalette, paletteName: '' }}
        />
      )

      expect(screen.getByText('Color Scheme')).toBeInTheDocument()
    })

    it('should handle very long paletteName', () => {
      const longName = 'A'.repeat(100)
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: longName }}
          result={{ palette: mockPalette }}
        />
      )

      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle palette with theme property', () => {
      const paletteWithTheme = { ...mockPalette, theme: 'dark' }
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Dark Theme' }}
          result={{ palette: paletteWithTheme }}
        />
      )

      expect(screen.getByText('Dark Theme')).toBeInTheDocument()
    })

    it('should not render when both mode and palette exist but status is not completed', () => {
      const { container } = renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="running"
          input={{ mode: 'apply', paletteName: 'Test' }}
          result={{ palette: mockPalette }}
        />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('integration with ColorPaletteWidget', () => {
    it('should pass correct props to ColorPaletteWidget', () => {
      renderWithProviders(
        <ColorSchemeToolRenderer
          toolName="colorScheme"
          toolStatus="completed"
          input={{ mode: 'apply', paletteName: 'Ocean Blue' }}
          result={{ palette: mockPalette }}
        />
      )

      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toBeInTheDocument()

      // Check that it's a div (readOnly)
      expect(widget.tagName).toBe('DIV')

      // Check that it displays the theme name
      expect(screen.getByText('Ocean Blue')).toBeInTheDocument()

      // Check that color circles are rendered
      const colorCircles = widget.querySelectorAll('.size-3.rounded-full')
      expect(colorCircles.length).toBeGreaterThan(0)
    })
  })
})
