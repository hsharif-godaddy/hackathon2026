import { cssSuggestAITool } from '../css-suggest.js'
import { cssColorAITool } from '../css-color.js'
import { describe, it, expect } from 'vitest'

describe('css-consistency', function packageTests() {
  describe('cssSuggest vs cssColor', function consistencyTests() {
    it('should generate identical palettes', async function compareGeneration() {
      const testPalette = { name: 'Test Blue', primary: '#3B82F6' }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {})
      
      expect(suggestResult.palettes[0].colors).toHaveLength(6)
      expect(colorResult.widget.colors).toHaveLength(6)
      
      for (let i = 0; i < 6; i++) {
        const suggestColor = suggestResult.palettes[0].colors[i]
        const colorColor = colorResult.widget.colors[i]
        
        expect(suggestColor.hex).toBe(colorColor.hex)
        expect(suggestColor.name).toBe(colorColor.name)
        expect(suggestColor.foreground).toBe(colorColor.foreground)
      }
    })

    it('should handle dark colors consistently', async function compareDark() {
      const darkPalette = { name: 'Dark Theme', primary: '#1a1a1a' }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [darkPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: darkPalette.name,
        primary: darkPalette.primary,
        generateOnly: true
      }, {})
      
      expect(suggestResult.palettes[0].colors[0].foreground).toBeTypeOf('string')
      expect(colorResult.widget.colors[0].foreground).toBeTypeOf('string')
      
      expect(suggestResult.palettes[0].colors[0].foreground)
        .toBe(colorResult.widget.colors[0].foreground)
    })

    it('should generate same secondary color', async function compareSecondary() {
      const testPalette = { name: 'Test', primary: '#3B82F6' }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {})
      
      expect(suggestResult.palettes[0].colors[1].hex)
        .toBe(colorResult.widget.colors[1].hex)
    })

    it('should generate same accent color', async function compareAccent() {
      const testPalette = { name: 'Test', primary: '#3B82F6' }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {})
      
      expect(suggestResult.palettes[0].colors[2].hex)
        .toBe(colorResult.widget.colors[2].hex)
    })

    it('should respect provided colors consistently', async function compareProvided() {
      const customPalette = {
        name: 'Custom',
        primary: '#3B82F6',
        secondary: '#10B981',
        accent: '#F59E0B'
      }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [customPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: customPalette.name,
        primary: customPalette.primary,
        secondary: customPalette.secondary,
        accent: customPalette.accent,
        generateOnly: true
      }, {})
      
      for (let i = 0; i < 3; i++) {
        expect(suggestResult.palettes[0].colors[i].hex)
          .toBe(colorResult.widget.colors[i].hex)
      }
    })

    it('should have matching foreground colors for all display colors', async function compareForegrounds() {
      const testPalette = { name: 'Test', primary: '#3B82F6' }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {})
      
      for (let i = 0; i < 6; i++) {
        const suggestFg = suggestResult.palettes[0].colors[i].foreground
        const colorFg = colorResult.widget.colors[i].foreground
        
        expect(suggestFg).toBeTypeOf('string')
        expect(colorFg).toBeTypeOf('string')
        expect(suggestFg).toBe(colorFg)
      }
    })

    it('should generate identical palettes for black primary', async function compareBlack() {
      const blackPalette = { name: 'Pure Black', primary: '#000000' }
      
      const suggestResult = await cssSuggestAITool.execute({
        palettes: [blackPalette]
      }, {})
      
      const colorResult = await cssColorAITool.execute({
        paletteName: blackPalette.name,
        primary: blackPalette.primary,
        generateOnly: true
      }, {})
      
      expect(suggestResult.palettes[0].colors[0].hex).toBe('#000000')
      expect(colorResult.widget.colors[0].hex).toBe('#000000')
      
      expect(suggestResult.palettes[0].colors[0].foreground)
        .toBe(colorResult.widget.colors[0].foreground)
    })
  })
})

