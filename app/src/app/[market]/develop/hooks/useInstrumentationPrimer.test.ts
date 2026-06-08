/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/utils/instrumentation', () => ({
  setInstrumentationAppId: vi.fn(),
  setInstrumentationBusinessName: vi.fn(),
  setInstrumentationCreationSource: vi.fn(),
  setInstrumentationEntryPoint: vi.fn(),
  setInstrumentationIntentCategory: vi.fn(),
  setInstrumentationPlanType: vi.fn(),
}))

vi.mock('@/utils/traffic-signals', () => ({
  readCreationSourceFromSession: vi.fn(() => undefined),
  readEntryPointFromSession: vi.fn(() => undefined),
  readIntentCategoryFromSession: vi.fn(() => undefined),
}))

import {
  setInstrumentationAppId,
  setInstrumentationBusinessName,
  setInstrumentationCreationSource,
  setInstrumentationEntryPoint,
  setInstrumentationIntentCategory,
  setInstrumentationPlanType,
} from '@/utils/instrumentation'
import {
  readCreationSourceFromSession,
  readEntryPointFromSession,
  readIntentCategoryFromSession,
} from '@/utils/traffic-signals'
import { useInstrumentationPrimer } from './useInstrumentationPrimer'

const mockSetAppId = vi.mocked(setInstrumentationAppId)
const mockSetBusinessName = vi.mocked(setInstrumentationBusinessName)
const mockSetCreationSource = vi.mocked(setInstrumentationCreationSource)
const mockSetEntryPoint = vi.mocked(setInstrumentationEntryPoint)
const mockSetIntentCategory = vi.mocked(setInstrumentationIntentCategory)
const mockSetPlanType = vi.mocked(setInstrumentationPlanType)

const mockReadEntryPoint = vi.mocked(readEntryPointFromSession)
const mockReadCreationSource = vi.mocked(readCreationSourceFromSession)
const mockReadIntentCategory = vi.mocked(readIntentCategoryFromSession)

function makeSearchParams(params: Record<string, string> = {}): any {
  return { get: (key: string) => params[key] ?? null }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
})

describe('useInstrumentationPrimer', () => {
  describe('when appId is set and not a job', () => {
    it('primes appId and planType', () => {
      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: 'airoplus',
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetAppId).toHaveBeenCalledWith('app-abc')
      expect(mockSetPlanType).toHaveBeenCalledWith('airoplus')
    })

    it('resolves intent_category=new_build when in-creation-flow marker is set', () => {
      sessionStorage.setItem('in-creation-flow-app-abc', 'true')
      mockReadIntentCategory.mockReturnValue(undefined)

      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetIntentCategory).toHaveBeenCalledWith('new_build')
    })

    it('resolves intent_category=edit for existing apps (no creation-flow marker)', () => {
      mockReadIntentCategory.mockReturnValue(undefined)

      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetIntentCategory).toHaveBeenCalledWith('edit')
    })

    it('uses intent_category from session when stored (overrides creation-flow)', () => {
      sessionStorage.setItem('in-creation-flow-app-abc', 'true')
      mockReadIntentCategory.mockReturnValue('edit')

      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetIntentCategory).toHaveBeenCalledWith('edit')
    })

    it('sets creationSource=my_apps and entryPoint=my_apps on return visit (?siteId present)', () => {
      mockReadCreationSource.mockReturnValue(undefined)
      mockReadEntryPoint.mockReturnValue(undefined)

      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams({ siteId: 'app-abc' }),
        }),
      )

      expect(mockSetCreationSource).toHaveBeenCalledWith('my_apps')
      expect(mockSetEntryPoint).toHaveBeenCalledWith('my_apps')
    })

    it('falls back to direct_nav entry point when session has no value', () => {
      mockReadEntryPoint.mockReturnValue(undefined)
      mockReadCreationSource.mockReturnValue(undefined)

      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetEntryPoint).toHaveBeenCalledWith('direct_nav')
    })

    it('uses entry point from session when stored at site creation', () => {
      mockReadEntryPoint.mockReturnValue('venture')

      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams({ site_location: 'some_other_location' }),
        }),
      )

      expect(mockSetEntryPoint).toHaveBeenCalledWith('venture')
    })
  })

  describe('when appId is null or isJobId', () => {
    it('clears all instrumentation fields including businessName when appId is null', () => {
      renderHook(() =>
        useInstrumentationPrimer({
          appId: null,
          isJobId: false,
          planType: null,
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetAppId).toHaveBeenCalledWith(null)
      expect(mockSetBusinessName).toHaveBeenCalledWith(null)
      expect(mockSetIntentCategory).toHaveBeenCalledWith(null)
    })

    it('clears all fields when isJobId is true', () => {
      renderHook(() =>
        useInstrumentationPrimer({
          appId: 'app-abc',
          isJobId: true,
          planType: null,
          searchParams: makeSearchParams(),
        }),
      )

      expect(mockSetAppId).toHaveBeenCalledWith(null)
      expect(mockSetBusinessName).toHaveBeenCalledWith(null)
    })
  })

  describe('cleanup on unmount', () => {
    it('nulls all fields except businessName on effect cleanup (searchParams re-run)', () => {
      const sp1 = makeSearchParams({ foo: 'a' })
      const sp2 = makeSearchParams({ foo: 'b' })

      const { rerender } = renderHook(
        ({ searchParams }: { searchParams: any }) =>
          useInstrumentationPrimer({
            appId: 'app-abc',
            isJobId: false,
            planType: 'airoplus',
            searchParams,
          }),
        { initialProps: { searchParams: sp1 } },
      )

      vi.clearAllMocks()

      act(() => {
        rerender({ searchParams: sp2 })
      })

      // Cleanup ran (nulled fields) then setup ran again
      expect(mockSetAppId).toHaveBeenCalledWith(null) // cleanup
      expect(mockSetAppId).toHaveBeenCalledWith('app-abc') // re-prime
      // businessName must NOT be cleared by the searchParams-triggered re-run
      expect(mockSetBusinessName).not.toHaveBeenCalled()
    })

    it('clears businessName when appId changes', () => {
      const { rerender } = renderHook(
        ({ appId }: { appId: string }) =>
          useInstrumentationPrimer({
            appId,
            isJobId: false,
            planType: null,
            searchParams: makeSearchParams(),
          }),
        { initialProps: { appId: 'app-abc' } },
      )

      vi.clearAllMocks()

      act(() => {
        rerender({ appId: 'app-def' })
      })

      // The useEffect([appId]) cleanup fires when appId changes → clears businessName
      expect(mockSetBusinessName).toHaveBeenCalledWith(null)
    })
  })
})
