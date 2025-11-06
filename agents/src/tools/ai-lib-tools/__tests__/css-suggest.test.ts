import { cssSuggestAITool } from '../css-suggest.js'
import { describe, it, expect } from 'vitest'

describe('css-suggest', function packageTests() {
  describe('#cssSuggestAITool', function suggestTests() {
    it('should format palettes with foreground colors', async function formatForegrounds() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test Blue', primary: '#3B82F6' },
          { name: 'Test Black', primary: '#000000' }
        ]
      }, {})

      expect(result.success).toBe(true)
      expect(result.palettes).toHaveLength(2)
      
      const firstPalette = result.palettes[0]
      expect(firstPalette.colors).toBeInstanceOf(Array)
      expect(firstPalette.colors[0]).toHaveProperty('foreground')
      expect(firstPalette.colors[0].foreground).toBeTypeOf('string')
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

    it('should format each palette with name and colors', async function formatStructure() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test Blue', primary: '#3B82F6' }
        ]
      }, {})

      const palette = result.palettes[0]
      expect(palette.name).toBe('Test Blue')
      expect(palette.colors).toBeInstanceOf(Array)
      expect(palette.colors).toHaveLength(6)
    })

    it('should include all color properties', async function includeProperties() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Test', primary: '#3B82F6' }
        ]
      }, {})

      const color = result.palettes[0].colors[0]
      expect(color).toHaveProperty('name')
      expect(color).toHaveProperty('hex')
      expect(color).toHaveProperty('role')
      expect(color).toHaveProperty('foreground')
    })

    it('should handle dark primary colors', async function handleDark() {
      const result = await cssSuggestAITool.execute({
        palettes: [
          { name: 'Dark Theme', primary: '#1a1a1a' }
        ]
      }, {})

      expect(result.success).toBe(true)
      const palette = result.palettes[0]
      expect(palette.colors[0].hex).toBe('#1a1a1a')
      expect(palette.colors[0].foreground).toBeTypeOf('string')
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

      const palette = result.palettes[0]
      expect(palette.colors[0].hex).toBe('#3B82F6')
      expect(palette.colors[1].hex).toBe('#10B981')
      expect(palette.colors[2].hex).toBe('#F59E0B')
    })
  })
})

