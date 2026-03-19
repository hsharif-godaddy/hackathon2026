import { generatePalette } from '../css-color-tool.js'
import { describe, it, expect } from 'vitest'

describe('css-color-tool', function packageTests() {
  describe('#generatePalette', function generateTests() {
    it('should generate complete palette from black primary', function generateBlack() {
      const result = generatePalette({ primary: '#000000' })
      
      expect(result.primary).toBe('#000000')
      expect(result.secondary).toBeTypeOf('string')
      expect(result.secondary).not.toBe('#000000')
      expect(result.primaryForeground).toBeTypeOf('string')
      expect(result.secondaryForeground).toBeTypeOf('string')
      expect(result.displayColors).toHaveLength(5)
    })

    it('should generate distinct secondary from dark primary', function generateDark() {
      const result = generatePalette({ primary: '#1a1a1a' })
      
      expect(result.secondary).not.toBe(result.primary)
      expect(result.secondary).not.toBe('#1a1a1a')
    })

    it('should include foreground colors for all display colors', function generateForegrounds() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.primaryForeground).toBeTypeOf('string')
      expect(result.secondaryForeground).toBeTypeOf('string')
      expect(result.accentForeground).toBeTypeOf('string')
      expect(result.mutedForeground).toBeTypeOf('string')
      expect(result.successForeground).toBeTypeOf('string')
      expect(result.destructiveForeground).toBeTypeOf('string')
    })

    it('should generate proper contrast for dark colors', function generateContrast() {
      const result = generatePalette({ primary: '#1a1a1a' })
      
      expect(result.primaryForeground).toBeTypeOf('string')
      expect(result.primaryForeground).not.toBe('#000000')
      expect(result.primaryForeground).not.toBe('#1a1a1a')
    })

    it('should use default background and foreground', function generateDefaults() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.background).toBe('#FFFFFF')
      expect(result.foreground).toBe('#0A0A0A')
    })

    it('should respect provided secondary and accent colors', function generateProvided() {
      const result = generatePalette({
        primary: '#3B82F6',
        secondary: '#10B981',
        accent: '#F59E0B'
      })
      
      expect(result.primary).toBe('#3B82F6')
      expect(result.secondary).toBe('#10B981')
      expect(result.accent).toBe('#F59E0B')
    })

    it('should generate semantic colors by default', function generateSemantic() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.destructive).toBe('#EF4444')
      expect(result.success).toBe('#10B981')
      expect(result.warning).toBe('#F59E0B')
    })

    it('should include all required display colors', function generateDisplay() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      expect(result.displayColors).toHaveLength(5)

      const colorNames = result.displayColors.map(function mapName(c) { return c.name })
      expect(colorNames).toContain('Base')
      expect(colorNames).toContain('Primary')
      expect(colorNames).toContain('Secondary')
      expect(colorNames).toContain('Accent')
      expect(colorNames).toContain('Muted')
    })

    it('should include hex and role for each display color', function generateMetadata() {
      const result = generatePalette({ primary: '#3B82F6' })
      
      result.displayColors.forEach(function checkColor(color) {
        expect(color.name).toBeTypeOf('string')
        expect(color.hex).toBeTypeOf('string')
        expect(color.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(color.role).toBeTypeOf('string')
      })
    })
  })
})

