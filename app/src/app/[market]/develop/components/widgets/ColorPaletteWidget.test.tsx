/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import * as previewThemeModule from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import { renderWithProviders } from '@/tests/test-utils'
import ColorPaletteWidget from './ColorPaletteWidget'

vi.mock('@/app/[market]/develop/components/utils/previewThemeInIframe', () => ({
  previewThemeInIframe: vi.fn()
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((flag: string) => {
    if (flag === 'airo-builder-theme-selection-chat') {
      return { data: true, isLoading: false, error: null }
    }
    return { data: false, isLoading: false, error: null }
  }),
}))

describe('ColorPaletteWidget', () => {
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

  describe('rendering', () => {
    it('should render without crashing', () => {
      renderWithProviders(<ColorPaletteWidget palette={mockPalette} />)
      expect(screen.getByTestId('color-palette-option')).toBeInTheDocument()
    })

    it('should render theme name when provided', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Ocean Blue" palette={mockPalette} />
      )
      expect(screen.getByText('Ocean Blue')).toBeInTheDocument()
    })

    it('should render default name when no name provided', () => {
      renderWithProviders(<ColorPaletteWidget palette={mockPalette} />)
      expect(screen.getByText('Color Scheme')).toBeInTheDocument()
    })

    it('should render as horizontal layout with theme name on left', () => {
      const { container } = renderWithProviders(
        <ColorPaletteWidget name="Test Theme" palette={mockPalette} />
      )
      const widget = container.querySelector('[data-testid="color-palette-option"]')
      expect(widget).toHaveClass('flex-row')
      expect(widget).toHaveClass('items-center')
    })

    it('should render four color circles', () => {
      const { container } = renderWithProviders(
        <ColorPaletteWidget palette={mockPalette} />
      )
      const colorCircles = container.querySelectorAll('.size-3.rounded-full')
      expect(colorCircles).toHaveLength(4)
    })

    it('should apply background color from palette', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveStyle({ backgroundColor: mockPalette.background })
    })

    it('should apply foreground color from palette', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveStyle({ color: mockPalette.foreground })
    })

    it('should render color circles with correct colors', () => {
      const { container } = renderWithProviders(
        <ColorPaletteWidget palette={mockPalette} />
      )
      const colorCircles = container.querySelectorAll('.size-3.rounded-full')

      expect(colorCircles[0]).toHaveStyle({ backgroundColor: mockPalette.primary })
      expect(colorCircles[1]).toHaveStyle({ backgroundColor: mockPalette.secondary })
      expect(colorCircles[2]).toHaveStyle({ backgroundColor: mockPalette.accent })
      expect(colorCircles[3]).toHaveStyle({ backgroundColor: mockPalette.muted })
    })

    it('should have color circles overlap with negative margin', () => {
      const { container } = renderWithProviders(
        <ColorPaletteWidget palette={mockPalette} />
      )
      const colorCircles = container.querySelectorAll('.size-3.rounded-full')

      // All circles except first should have -ml-1
      for (let i = 0; i < colorCircles.length; i++) {
        if (i === 0) {
          expect(colorCircles[i]).toHaveClass('first:ml-0')
        }
        expect(colorCircles[i]).toHaveClass('-ml-1')
      }
    })

    it('should position color circles on the right with ml-auto', () => {
      const { container } = renderWithProviders(
        <ColorPaletteWidget palette={mockPalette} />
      )
      const circlesContainer = container.querySelector('.ml-auto')
      expect(circlesContainer).toBeInTheDocument()
      expect(circlesContainer).toHaveClass('flex-row')
    })
  })

  describe('readOnly mode', () => {
    it('should render as div when readOnly is true', () => {
      const { container } = renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} readOnly />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget.tagName).toBe('DIV')
      expect(container.querySelector('button')).not.toBeInTheDocument()
    })

    it('should not have hover classes when readOnly', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} readOnly />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).not.toHaveClass('hover:shadow-md')
      expect(widget).not.toHaveClass('hover:cursor-pointer')
    })

    it('should not call previewThemeInIframe when clicked in readOnly mode', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} readOnly />
      )
      const widget = screen.getByTestId('color-palette-option')
      await user.click(widget)

      expect(previewThemeModule.previewThemeInIframe).not.toHaveBeenCalled()
    })
  })

  describe('interactive mode', () => {
    it('should render as button when readOnly is false', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} readOnly={false} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget.tagName).toBe('BUTTON')
      expect(widget).toHaveAttribute('type', 'button')
    })

    it('should have hover classes when not readOnly', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('hover:shadow-md')
      expect(widget).toHaveClass('hover:cursor-pointer')
    })

    it('should call previewThemeInIframe when clicked', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteWidget name="Ocean Blue" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      await user.click(widget)

      expect(previewThemeModule.previewThemeInIframe).toHaveBeenCalledWith(
        'Ocean Blue',
        mockPalette
      )
    })

    it('should not call previewThemeInIframe when name is not provided', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteWidget palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      await user.click(widget)

      expect(previewThemeModule.previewThemeInIframe).not.toHaveBeenCalled()
    })

    it('should handle multiple clicks', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')

      await user.click(widget)
      await user.click(widget)
      await user.click(widget)

      expect(previewThemeModule.previewThemeInIframe).toHaveBeenCalledTimes(3)
    })
  })

  describe('selection state', () => {
    it('should apply shadow when isSelected is true', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} isSelected />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('shadow-md')
    })

    it('should not apply shadow when isSelected is false', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} isSelected={false} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).not.toHaveClass('shadow-md')
    })
  })

  describe('similar color handling', () => {
    it('should add box shadow to color circles similar to background', () => {
      const paletteWithSimilarColors: CompletePalette = {
        ...mockPalette,
        background: '#ffffff',
        primary: '#fefefe' // Very similar to background
      }

      const { container } = renderWithProviders(
        <ColorPaletteWidget palette={paletteWithSimilarColors} />
      )

      const firstCircle = container.querySelectorAll('.size-3.rounded-full')[0]
      // Should have box shadow for contrast
      expect(firstCircle).toHaveAttribute('style')
      expect(firstCircle.getAttribute('style')).toContain('box-shadow')
    })
  })

  describe('compact layout', () => {
    it('should have compact padding for shorter height', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('px-1.5')
      expect(widget).toHaveClass('py-1')
    })

    it('should have 2px border', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('border-2')
    })

    it('should have rounded corners', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('rounded-md')
    })
  })

  describe('custom className', () => {
    it('should apply custom className', () => {
      renderWithProviders(
        <ColorPaletteWidget
          name="Test"
          palette={mockPalette}
          className="custom-class"
        />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('custom-class')
    })

    it('should preserve base classes with custom className', () => {
      renderWithProviders(
        <ColorPaletteWidget
          name="Test"
          palette={mockPalette}
          className="custom-class"
        />
      )
      const widget = screen.getByTestId('color-palette-option')
      expect(widget).toHaveClass('custom-class')
      expect(widget).toHaveClass('flex')
      expect(widget).toHaveClass('flex-row')
    })
  })

  describe('text truncation', () => {
    it('should truncate long theme names', () => {
      renderWithProviders(
        <ColorPaletteWidget
          name="This is a very long theme name that should be truncated"
          palette={mockPalette}
        />
      )
      const themeName = screen.getByText('This is a very long theme name that should be truncated')
      expect(themeName).toHaveClass('truncate')
    })

    it('should have min-w-0 for proper flex truncation', () => {
      renderWithProviders(
        <ColorPaletteWidget name="Test" palette={mockPalette} />
      )
      const themeName = screen.getByText('Test')
      expect(themeName).toHaveClass('min-w-0')
    })
  })
})
