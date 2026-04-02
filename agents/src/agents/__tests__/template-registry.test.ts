import { describe, it, expect } from 'vitest'
import { templateRegistry, getTemplate, getTemplateIds } from '../template-registry.js'

describe('template-registry', () => {
  describe('templateRegistry', () => {
    it('should contain business-plan template', () => {
      expect(templateRegistry['business-plan']).toBeDefined()
      expect(templateRegistry['business-plan'].id).toBe('business-plan')
      expect(templateRegistry['business-plan'].name).toBe('Business Plan Website')
      expect(templateRegistry['business-plan'].description).toBeTruthy()
    })

    it('should contain logo-designer template', () => {
      expect(templateRegistry['logo-designer']).toBeDefined()
      expect(templateRegistry['logo-designer'].id).toBe('logo-designer')
      expect(templateRegistry['logo-designer'].name).toBe('Logo Designer')
      expect(templateRegistry['logo-designer'].description).toBeTruthy()
    })
  })

  describe('getTemplate', () => {
    it('should return template by id', () => {
      const template = getTemplate('business-plan')
      expect(template).toBeDefined()
      expect(template!.id).toBe('business-plan')
    })

    it('should return undefined for unknown template', () => {
      expect(getTemplate('nonexistent')).toBeUndefined()
    })
  })

  describe('getTemplateIds', () => {
    it('should return all registered template ids', () => {
      const ids = getTemplateIds()
      expect(ids).toContain('business-plan')
      expect(ids.length).toBeGreaterThanOrEqual(1)
    })
  })
})
