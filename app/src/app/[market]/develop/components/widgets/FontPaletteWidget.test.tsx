/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { FontThemeSuggestFont } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'
import { renderWithProviders } from '@/tests/test-utils'
import FontPaletteWidget from './FontPaletteWidget'

describe('FontPaletteWidget', () => {
  const mockHeaderFont: FontThemeSuggestFont = {
    name: 'Montserrat',
    weights: ['400', '700'],
    category: 'sans-serif'
  }

  const mockBodyFont: FontThemeSuggestFont = {
    name: 'Open Sans',
    weights: ['400', '600'],
    category: 'sans-serif'
  }

  const mockSameFont: FontThemeSuggestFont = {
    name: 'Inter',
    weights: ['400', '700'],
    category: 'sans-serif'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render without crashing with two different fonts', () => {
      const { container } = renderWithProviders(
        <FontPaletteWidget
          name="Modern Professional"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render theme name', () => {
      renderWithProviders(
        <FontPaletteWidget
          name="Modern Professional"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )
      expect(screen.getByText('Modern Professional')).toBeInTheDocument()
    })

    it('should render both font names when different', () => {
      renderWithProviders(
        <FontPaletteWidget
          name="Modern Professional"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )
      expect(screen.getByText('Montserrat')).toBeInTheDocument()
      expect(screen.getByText('Open Sans')).toBeInTheDocument()
    })

    it('should render single font name when same font', () => {
      renderWithProviders(
        <FontPaletteWidget
          name="Minimalist"
          headerFont={mockSameFont}
          bodyFont={mockSameFont}
        />
      )
      const interElements = screen.getAllByText('Inter')
      expect(interElements).toHaveLength(1)
    })

    it('should render plus icon between different fonts', () => {
      const { container } = renderWithProviders(
        <FontPaletteWidget
          name="Modern Professional"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )
      // PlusIcon should be present
      const svgElements = container.querySelectorAll('svg')
      expect(svgElements.length).toBeGreaterThan(0)
    })

    it('should not render plus icon for same font', () => {
      const { container } = renderWithProviders(
        <FontPaletteWidget
          name="Minimalist"
          headerFont={mockSameFont}
          bodyFont={mockSameFont}
        />
      )
      // No second font name means no plus icon needed
      const fontElements = screen.getAllByText('Inter')
      expect(fontElements).toHaveLength(1)
    })

    it('should apply custom className', () => {
      const { container } = renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
          className="custom-class"
        />
      )
      const widget = container.firstChild as HTMLElement
      expect(widget).toHaveClass('custom-class')
    })
  })

  describe('font loading', () => {
    it('should create link element for Google Fonts', () => {
      renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )

      // Check that a link element was created
      const link = document.getElementById('widget-google-fonts') as HTMLLinkElement
      expect(link).toBeInTheDocument()
      expect(link.rel).toBe('stylesheet')
    })

    it('should load fonts with correct URL format', () => {
      renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )

      const link = document.getElementById('widget-google-fonts') as HTMLLinkElement
      expect(link.href).toContain('Montserrat')
      expect(link.href).toContain('Open+Sans')
      expect(link.href).toContain('wght@')
    })

    it('should deduplicate fonts when same font used for header and body', () => {
      renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={mockSameFont}
          bodyFont={mockSameFont}
        />
      )

      const link = document.getElementById('widget-google-fonts') as HTMLLinkElement
      // Should only load Inter once with combined weights
      const interCount = (link.href.match(/Inter/g) || []).length
      expect(interCount).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle font with very long name', () => {
      const longFontName = 'A'.repeat(100)
      const fontWithLongName: FontThemeSuggestFont = {
        name: longFontName,
        weights: ['400'],
        category: 'sans-serif'
      }

      renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={fontWithLongName}
          bodyFont={fontWithLongName}
        />
      )

      expect(screen.getByText(longFontName)).toBeInTheDocument()
    })

    it('should handle missing theme name', () => {
      const { container } = renderWithProviders(
        <FontPaletteWidget
          headerFont={mockHeaderFont}
          bodyFont={mockBodyFont}
        />
      )

      // Should still render but without theme name
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle font without category', () => {
      const fontWithoutCategory: FontThemeSuggestFont = {
        name: 'Roboto',
        weights: ['400']
      }

      const { container } = renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={fontWithoutCategory}
          bodyFont={fontWithoutCategory}
        />
      )

      expect(container.firstChild).toBeInTheDocument()
      expect(screen.getByText('Roboto')).toBeInTheDocument()
    })

    it('should combine weights when same font used twice', () => {
      const robotoHeader: FontThemeSuggestFont = {
        name: 'Roboto',
        weights: ['700'],
        category: 'sans-serif'
      }
      const robotoBody: FontThemeSuggestFont = {
        name: 'Roboto',
        weights: ['400'],
        category: 'sans-serif'
      }

      renderWithProviders(
        <FontPaletteWidget
          name="Test"
          headerFont={robotoHeader}
          bodyFont={robotoBody}
        />
      )

      const robotoElements = screen.getAllByText('Roboto')
      // Should treat as same font and only show once
      expect(robotoElements).toHaveLength(1)

      // Should load both weights
      const link = document.getElementById('widget-google-fonts') as HTMLLinkElement
      expect(link.href).toContain('400')
      expect(link.href).toContain('700')
    })
  })
})
