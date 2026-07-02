/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useLogoDesignerEntryTracking } from './useLogoDesignerEntryTracking'

const mockLogLogoDesignerEntry = vi.fn()

vi.mock('@/lib/logo-designer-entry', () => ({
  logLogoDesignerEntry: (...args: unknown[]) => mockLogLogoDesignerEntry(...args),
}))

describe('useLogoDesignerEntryTracking', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'location', {
      value: { search: '', pathname: '/en-US', hash: '' },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  describe('when logo-designer mode is present', () => {
    it("logs the entry with source 'deeplink' for the canonical ?mode= param", () => {
      window.location.search = '?mode=logo-designer'

      renderHook(() => useLogoDesignerEntryTracking())

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
      expect(mockLogLogoDesignerEntry).toHaveBeenCalledWith('deeplink')
    })

    it("logs the entry with source 'deeplink' for the legacy ?template= alias", () => {
      window.location.search = '?template=logo-designer'

      renderHook(() => useLogoDesignerEntryTracking())

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
      expect(mockLogLogoDesignerEntry).toHaveBeenCalledWith('deeplink')
    })
  })

  describe('when template is missing or different', () => {
    it('does not fire when template param is absent', () => {
      window.location.search = ''

      renderHook(() => useLogoDesignerEntryTracking())

      expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()
    })

    it('does not fire for a different template value', () => {
      window.location.search = '?template=business-plan'

      renderHook(() => useLogoDesignerEntryTracking())

      expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()
    })
  })

  describe('enabled gate', () => {
    beforeEach(() => {
      window.location.search = '?template=logo-designer'
    })

    it('does not fire when enabled is false', () => {
      renderHook(() => useLogoDesignerEntryTracking({ enabled: false }))

      expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()
    })

    it('fires when enabled becomes true', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useLogoDesignerEntryTracking({ enabled }),
        { initialProps: { enabled: false } },
      )

      expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()

      rerender({ enabled: true })

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
    })

    it('defaults enabled to true', () => {
      renderHook(() => useLogoDesignerEntryTracking())

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
    })
  })

  describe('one-shot behavior', () => {
    beforeEach(() => {
      window.location.search = '?template=logo-designer'
    })

    it('only fires once across multiple rerenders', () => {
      const { rerender } = renderHook(() => useLogoDesignerEntryTracking())

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)

      rerender()
      rerender()
      rerender()

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
    })

    it('only fires once even if enabled toggles', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useLogoDesignerEntryTracking({ enabled }),
        { initialProps: { enabled: true } },
      )

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)

      rerender({ enabled: false })
      rerender({ enabled: true })

      expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
    })
  })
})
