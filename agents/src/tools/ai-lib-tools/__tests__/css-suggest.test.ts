import { cssSuggestAITool } from '../css-suggest.js'
import { describe, it, expect } from 'vitest'

describe('css-suggest', function packageTests() {
  describe('#cssSuggestAITool', function suggestTests() {
    it('should format palettes with theme and palette data', async function formatPalettes() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test Blue', primary: '#3B82F6' },
          { name: 'Test Black', primary: '#000000' }
        ]
      }, {})

      expect(result.success).toBe(true)
      expect(result.palettes).toHaveLength(2)

      const firstPalette = result.palettes[0]
      expect(firstPalette).toHaveProperty('name')
      expect(firstPalette).toHaveProperty('theme')
      expect(firstPalette).toHaveProperty('palette')
      expect(firstPalette.palette).toHaveProperty('primary')
      expect(firstPalette.palette).toHaveProperty('primaryForeground')
    })

    it('should generate multiple palettes', async function generateMultiple() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Ocean Blue', primary: '#0077BE' },
          { name: 'Forest Green', primary: '#228B22' },
          { name: 'Sunset Orange', primary: '#FF6347' },
          { name: 'Royal Purple', primary: '#6A0DAD' }
        ]
      }, {})

      expect(result.success).toBe(true)
      expect(result.palettes).toHaveLength(4)
    })

    it('should include widget data structure', async function includeWidget() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test', primary: '#3B82F6' }
        ]
      }, {})

      expect(result.widget).toBeTypeOf('object')
      expect(result.widget.widgetType).toBe('color-palette-grid')
      expect(result.widget.widgetData).toBeTypeOf('object')
      expect(result.widget.widgetData.palettes).toBeInstanceOf(Array)
    })

    it('should format each palette with name and palette object', async function formatStructure() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test Blue', primary: '#3B82F6' }
        ]
      }, {})

      const palette = result.palettes[0]
      expect(palette.name).toBe('Test Blue')
      expect(palette.palette).toBeTypeOf('object')
      expect(palette.palette).toHaveProperty('primary')
      expect(palette.palette).toHaveProperty('secondary')
      expect(palette.palette).toHaveProperty('accent')
      expect(palette.palette).toHaveProperty('background')
      expect(palette.palette).toHaveProperty('foreground')
      expect(palette.palette).toHaveProperty('muted')
    })

    it('should include all palette color properties', async function includeProperties() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test', primary: '#3B82F6' }
        ]
      }, {})

      const palette = result.palettes[0].palette
      expect(palette).toHaveProperty('primary')
      expect(palette).toHaveProperty('primaryForeground')
      expect(palette).toHaveProperty('secondary')
      expect(palette).toHaveProperty('secondaryForeground')
      expect(palette).toHaveProperty('accent')
      expect(palette).toHaveProperty('accentForeground')
      expect(palette).toHaveProperty('background')
      expect(palette).toHaveProperty('foreground')
      expect(palette).toHaveProperty('muted')
      expect(palette).toHaveProperty('mutedForeground')
      expect(palette).toHaveProperty('border')
    })

    it('should handle dark primary colors', async function handleDark() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Dark Theme', primary: '#1a1a1a' }
        ]
      }, {})

      expect(result.success).toBe(true)
      const palette = result.palettes[0]
      expect(palette.palette.primary).toBe('#1a1a1a')
      expect(palette.palette.primaryForeground).toBeTypeOf('string')
    })

    it('should respect provided secondary and accent', async function respectProvided() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          {
            name: 'Custom',
            primary: '#3B82F6',
            secondary: '#10B981',
            accent: '#F59E0B'
          }
        ]
      }, {})

      const palette = result.palettes[0].palette
      expect(palette.primary).toBe('#3B82F6')
      expect(palette.secondary).toBe('#10B981')
      expect(palette.accent).toBe('#F59E0B')
    })
  })
})
