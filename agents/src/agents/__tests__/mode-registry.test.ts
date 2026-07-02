import { describe, it, expect } from 'vitest'
import { modeRegistry, getMode, getModeIds } from '../mode-registry.js'

describe('mode-registry', () => {
  describe('modeRegistry', () => {
    it('should contain business-plan mode', () => {
      expect(modeRegistry['business-plan']).toBeDefined()
      expect(modeRegistry['business-plan'].id).toBe('business-plan')
      expect(modeRegistry['business-plan'].name).toBe('Business Plan Website')
      expect(modeRegistry['business-plan'].description).toBeTruthy()
    })

    it('should contain logo-designer mode', () => {
      expect(modeRegistry['logo-designer']).toBeDefined()
      expect(modeRegistry['logo-designer'].id).toBe('logo-designer')
      expect(modeRegistry['logo-designer'].name).toBe('Logo Designer')
      expect(modeRegistry['logo-designer'].description).toBeTruthy()
    })
  })

  describe('getMode', () => {
    it('should return mode by id', () => {
      const mode = getMode('business-plan')
      expect(mode).toBeDefined()
      expect(mode!.id).toBe('business-plan')
    })

    it('should return undefined for unknown mode', () => {
      expect(getMode('nonexistent')).toBeUndefined()
    })
  })

  describe('getModeIds', () => {
    it('should return all registered mode ids', () => {
      const ids = getModeIds()
      expect(ids).toContain('business-plan')
      expect(ids.length).toBeGreaterThanOrEqual(1)
    })
  })
})
