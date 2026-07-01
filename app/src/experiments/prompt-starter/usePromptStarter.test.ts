/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useHivemind } from '@/hooks/useHivemind'
import { usePromptStarter } from './usePromptStarter'

vi.mock('@/hooks/useHivemind', () => ({ useHivemind: vi.fn() }))

const mockUseHivemind = vi.mocked(useHivemind)

function setCohort(cohort: string | undefined): void {
  mockUseHivemind.mockReturnValue({ cohort, data: undefined, experiment: undefined })
}

describe('usePromptStarter', function promptStarterTests() {
  beforeEach(function setup() {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    setCohort(undefined)
  })

  afterEach(function teardown() {
    vi.clearAllMocks()
  })

  it('returns false in the control cohort (off)', function control() {
    setCohort('off')
    const { result } = renderHook(() => usePromptStarter())
    expect(result.current).toBe(false)
  })

  it('returns false when no cohort is assigned', function unassigned() {
    setCohort(undefined)
    const { result } = renderHook(() => usePromptStarter())
    expect(result.current).toBe(false)
  })

  it('returns true in the treatment cohort (on)', function treatment() {
    setCohort('on')
    const { result } = renderHook(() => usePromptStarter())
    expect(result.current).toBe(true)
  })

  it('localStorage override forces the treatment on over an off cohort', function localStorageOverride() {
    setCohort('off')
    window.localStorage.setItem('promptStarter', 'on')
    const { result } = renderHook(() => usePromptStarter())
    expect(result.current).toBe(true)
  })

  it('query-param override wins over the assigned cohort', function queryOverride() {
    setCohort('on')
    window.history.replaceState({}, '', '/?promptStarter=off')
    const { result } = renderHook(() => usePromptStarter())
    expect(result.current).toBe(false)
  })
})
