import { cssSuggestAITool } from '../css-suggest.js'
import { cssColorAITool } from '../css-color.js'
import { describe, it, expect, vi } from 'vitest'

// Mock dependencies that css-color imports
vi.mock('../../../database/connection.js', () => ({
  db: {
    prepare: vi.fn(),
    exec: vi.fn(),
    transaction: vi.fn()
  }
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function () { return {
    findById: vi.fn()
  }; })
}))

vi.mock('../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    withContext: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }; })
  },
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }; })
  }
}))

vi.mock('../../app-plan-tool.js', () => ({
  appPlanTool: {
    execute: vi.fn()
  }
}))

describe('css-consistency', function packageTests() {
  describe('cssSuggest vs cssColor', function consistencyTests() {
    it('should generate identical palettes', async function compareGeneration() {
      const testPalette = { name: 'Test Blue', primary: '#3B82F6' }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette, { name: 'Test Red', primary: '#EF4444' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {} as any) as any

      // cssSuggest returns palettes array with {name, theme, palette: {...}}
      // cssColor returns widget with {name, theme, palette: {...}}
      const suggestPalette = suggestResult.palettes[0].palette
      const colorPalette = colorResult.palette

      expect(suggestPalette.primary).toBe(colorPalette.primary)
      expect(suggestPalette.secondary).toBe(colorPalette.secondary)
      expect(suggestPalette.accent).toBe(colorPalette.accent)
      expect(suggestPalette.primaryForeground).toBe(colorPalette.primaryForeground)
    })

    it('should handle dark colors consistently', async function compareDark() {
      const darkPalette = { name: 'Dark Theme', primary: '#1a1a1a' }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [darkPalette, { name: 'Another', primary: '#333333' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: darkPalette.name,
        primary: darkPalette.primary,
        generateOnly: true
      }, {} as any) as any

      const suggestPalette = suggestResult.palettes[0].palette
      const colorPalette = colorResult.palette

      expect(suggestPalette.primaryForeground).toBeTypeOf('string')
      expect(colorPalette.primaryForeground).toBeTypeOf('string')
      expect(suggestPalette.primaryForeground).toBe(colorPalette.primaryForeground)
    })

    it('should generate same secondary color', async function compareSecondary() {
      const testPalette = { name: 'Test', primary: '#3B82F6' }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette, { name: 'Other', primary: '#FF0000' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {} as any) as any

      expect(suggestResult.palettes[0].palette.secondary)
        .toBe(colorResult.palette.secondary)
    })

    it('should generate same accent color', async function compareAccent() {
      const testPalette = { name: 'Test', primary: '#3B82F6' }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette, { name: 'Other', primary: '#FF0000' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {} as any) as any

      expect(suggestResult.palettes[0].palette.accent)
        .toBe(colorResult.palette.accent)
    })

    it('should respect provided colors consistently', async function compareProvided() {
      const customPalette = {
        name: 'Custom',
        primary: '#3B82F6',
        secondary: '#10B981',
        accent: '#F59E0B'
      }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [customPalette, { name: 'Other', primary: '#FF0000' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: customPalette.name,
        primary: customPalette.primary,
        secondary: customPalette.secondary,
        accent: customPalette.accent,
        generateOnly: true
      }, {} as any) as any

      const suggestPalette = suggestResult.palettes[0].palette
      const colorPalette = colorResult.palette

      expect(suggestPalette.primary).toBe(colorPalette.primary)
      expect(suggestPalette.secondary).toBe(colorPalette.secondary)
      expect(suggestPalette.accent).toBe(colorPalette.accent)
    })

    it('should have matching foreground colors for primary', async function compareForegrounds() {
      const testPalette = { name: 'Test', primary: '#3B82F6' }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [testPalette, { name: 'Other', primary: '#FF0000' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: testPalette.name,
        primary: testPalette.primary,
        generateOnly: true
      }, {} as any) as any

      const suggestPalette = suggestResult.palettes[0].palette
      const colorPalette = colorResult.palette

      expect(suggestPalette.primaryForeground).toBeTypeOf('string')
      expect(colorPalette.primaryForeground).toBeTypeOf('string')
      expect(suggestPalette.primaryForeground).toBe(colorPalette.primaryForeground)
      expect(suggestPalette.secondaryForeground).toBe(colorPalette.secondaryForeground)
      expect(suggestPalette.accentForeground).toBe(colorPalette.accentForeground)
    })

    it('should generate identical palettes for black primary', async function compareBlack() {
      const blackPalette = { name: 'Pure Black', primary: '#000000' }

      const suggestResult = await cssSuggestAITool.execute({
        palettes: [blackPalette, { name: 'Other', primary: '#FFFFFF' }]
      }, {} as any) as any

      const colorResult = await cssColorAITool.execute({
        paletteName: blackPalette.name,
        primary: blackPalette.primary,
        generateOnly: true
      }, {} as any) as any

      expect(suggestResult.palettes[0].palette.primary).toBe('#000000')
      expect(colorResult.palette.primary).toBe('#000000')

      expect(suggestResult.palettes[0].palette.primaryForeground)
        .toBe(colorResult.palette.primaryForeground)
    })
  })
})
