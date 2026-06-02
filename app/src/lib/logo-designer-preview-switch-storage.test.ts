// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  hasAutoSwitchedLogoDesignerPreview,
  isLogoDesignerApp,
  markAutoSwitchedLogoDesignerPreview,
  markLogoDesignerApp,
} from './logo-designer-preview-switch-storage'

describe('logo-designer-preview-switch-storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isLogoDesignerApp / markLogoDesignerApp', () => {
    it('returns false before the app is marked', () => {
      expect(isLogoDesignerApp('app-1')).toBe(false)
    })

    it('returns true after marking, scoped to the given appId', () => {
      markLogoDesignerApp('app-1')
      expect(isLogoDesignerApp('app-1')).toBe(true)
      expect(isLogoDesignerApp('app-2')).toBe(false)
    })

    it('writes the expected localStorage key', () => {
      markLogoDesignerApp('abc123')
      expect(window.localStorage.getItem('airo-logo-designer-app:abc123')).toBe('true')
    })

    it('is idempotent when called repeatedly', () => {
      markLogoDesignerApp('app-1')
      markLogoDesignerApp('app-1')
      expect(isLogoDesignerApp('app-1')).toBe(true)
    })
  })

  describe('hasAutoSwitchedLogoDesignerPreview / markAutoSwitchedLogoDesignerPreview', () => {
    it('returns false before the switch is marked', () => {
      expect(hasAutoSwitchedLogoDesignerPreview('app-1')).toBe(false)
    })

    it('returns true after marking, scoped to the given appId', () => {
      markAutoSwitchedLogoDesignerPreview('app-1')
      expect(hasAutoSwitchedLogoDesignerPreview('app-1')).toBe(true)
      expect(hasAutoSwitchedLogoDesignerPreview('app-2')).toBe(false)
    })

    it('writes the expected localStorage key', () => {
      markAutoSwitchedLogoDesignerPreview('abc123')
      expect(window.localStorage.getItem('airo-logo-designer-auto-switched-preview:abc123')).toBe('true')
    })
  })

  describe('marker independence', () => {
    it('marking the app does not mark it as auto-switched', () => {
      markLogoDesignerApp('app-1')
      expect(isLogoDesignerApp('app-1')).toBe(true)
      expect(hasAutoSwitchedLogoDesignerPreview('app-1')).toBe(false)
    })

    it('marking auto-switched does not mark it as a logo-designer app', () => {
      markAutoSwitchedLogoDesignerPreview('app-1')
      expect(hasAutoSwitchedLogoDesignerPreview('app-1')).toBe(true)
      expect(isLogoDesignerApp('app-1')).toBe(false)
    })
  })

  describe('localStorage failures', () => {
    it('isLogoDesignerApp returns false when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function () {
        throw new Error('localStorage unavailable')
      })
      expect(isLogoDesignerApp('app-1')).toBe(false)
    })

    it('markLogoDesignerApp does not throw when localStorage.setItem throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function () {
        throw new Error('quota exceeded')
      })
      expect(() => markLogoDesignerApp('app-1')).not.toThrow()
    })

    it('hasAutoSwitchedLogoDesignerPreview returns false when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function () {
        throw new Error('localStorage unavailable')
      })
      expect(hasAutoSwitchedLogoDesignerPreview('app-1')).toBe(false)
    })

    it('markAutoSwitchedLogoDesignerPreview does not throw when localStorage.setItem throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function () {
        throw new Error('quota exceeded')
      })
      expect(() => markAutoSwitchedLogoDesignerPreview('app-1')).not.toThrow()
    })
  })
})
