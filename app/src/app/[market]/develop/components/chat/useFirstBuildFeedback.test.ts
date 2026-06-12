/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockFlag: boolean | undefined = true
let mockInitialBuildComplete: boolean | undefined = false
let mockStoreAppId: string | undefined = 'app1'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockFlag,
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (s: { app: { id?: string; initialBuildComplete?: boolean } | null }) => unknown) =>
    selector({ app: mockInitialBuildComplete !== undefined ? { id: mockStoreAppId, initialBuildComplete: mockInitialBuildComplete } : null }),
}))

const mockGetItem = vi.fn()
const mockSetItem = vi.fn()
vi.mock('@/utils/localStorage', () => ({
  safeGetItem: (key: string) => mockGetItem(key),
  safeSetItem: (key: string, value: string) => mockSetItem(key, value),
}))

vi.mock('@/config/switchboard-flags', () => ({
  SWITCHBOARD_APPBUILDER_FIRST_BUILD_FEEDBACK: 'appbuilder-first-build-feedback',
}))

import { useFirstBuildFeedback } from './useFirstBuildFeedback'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useFirstBuildFeedback', () => {
  beforeEach(() => {
    mockFlag = true
    mockInitialBuildComplete = true
    mockStoreAppId = 'app1'
    mockGetItem.mockReturnValue(null)
    mockSetItem.mockReset()
  })

  it('returns null when flag is off', () => {
    mockFlag = false
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('returns null when flag is undefined', () => {
    mockFlag = undefined
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('returns null when initialBuildComplete is false', () => {
    mockInitialBuildComplete = false
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('returns null when store holds a different app (stale navigation state)', () => {
    mockStoreAppId = 'different-app'
    mockInitialBuildComplete = true
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('returns null when already answered (localStorage)', () => {
    mockGetItem.mockImplementation((key: string) =>
      key === 'fbf_answered_app1' ? 'magical' : null
    )
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('returns null when skipped (localStorage)', () => {
    mockGetItem.mockImplementation((key: string) =>
      key === 'fbf_skipped_app1' ? 'true' : null
    )
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('returns result when all checks pass', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).not.toBeNull()
    expect(result.current?.step).toBe('prompt')
  })

  it('advance moves to close_followup', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.advance('close_followup'))
    expect(result.current?.step).toBe('close_followup')
  })

  it('advance moves to offbase_followup', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.advance('offbase_followup'))
    expect(result.current?.step).toBe('offbase_followup')
  })

  it('dismiss magical writes localStorage and returns null', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.dismiss('magical'))
    expect(mockSetItem).toHaveBeenCalledWith('fbf_answered_app1', 'magical')
    expect(result.current).toBeNull()
  })

  it('dismiss skipped writes localStorage and returns null', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.dismiss('skipped'))
    expect(mockSetItem).toHaveBeenCalledWith('fbf_skipped_app1', 'true')
    expect(result.current).toBeNull()
  })

  it('dismiss chatted-past returns null without writing localStorage', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.dismiss('chatted-past'))
    expect(mockSetItem).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('dismiss close writes localStorage answered', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.dismiss('close'))
    expect(mockSetItem).toHaveBeenCalledWith('fbf_answered_app1', 'close')
    expect(result.current).toBeNull()
  })
})
