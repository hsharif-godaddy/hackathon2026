/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockFlag: boolean | undefined = true
let mockInitialBuildComplete: boolean | undefined = false
let mockStoreAppId: string | undefined = 'app1'
let mockFirstFileEdit = true

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockFlag,
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (s: { app: { id?: string; initialBuildComplete?: boolean } | null }) => unknown) =>
    selector({ app: mockInitialBuildComplete !== undefined ? { id: mockStoreAppId, initialBuildComplete: mockInitialBuildComplete } : null }),
}))

vi.mock('@/app/[market]/develop/hooks/useInitialBuildRevealSignals', () => ({
  useJtbdFeedbackRevealSignal: () => ({
    firstFileEdit: mockFirstFileEdit,
    logoDownload: false,
    logoDownstreamApply: false,
    websitePublish: false,
    websiteDomainConnect: false,
    domainPurchase: false,
    domainDownstreamConnect: false,
    imageSelection: false,
    isRevealReady: false,
  }),
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
    mockFirstFileEdit = true
    mockGetItem.mockReturnValue(null)
    mockSetItem.mockReset()
  })

  it('returns null when no agent file edit has been recorded for this app', () => {
    mockFirstFileEdit = false
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
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

  it('dismiss chatted-past persists the skip key so the panel stays resolved (fires once)', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.dismiss('chatted-past'))
    expect(mockSetItem).toHaveBeenCalledWith('fbf_skipped_app1', 'true')
    expect(result.current).toBeNull()
  })

  it('dismiss close writes localStorage answered', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.dismiss('close'))
    expect(mockSetItem).toHaveBeenCalledWith('fbf_answered_app1', 'close')
    expect(result.current).toBeNull()
  })

  it('persists the shown marker the first time the survey qualifies to show', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).not.toBeNull()
    expect(mockSetItem).toHaveBeenCalledWith('fbf_shown_app1', 'true')
  })

  it('re-shows after refresh via the persisted marker even when initialBuildComplete is false', () => {
    mockInitialBuildComplete = false
    mockGetItem.mockImplementation((key: string) => (key === 'fbf_shown_app1' ? 'true' : null))
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).not.toBeNull()
    expect(result.current?.step).toBe('prompt')
  })

  it('does not persist the shown marker when the survey does not qualify', () => {
    mockInitialBuildComplete = false
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
    expect(mockSetItem).not.toHaveBeenCalledWith('fbf_shown_app1', 'true')
  })

  it('shown marker does not bypass the other gates (no agent file edit → still null)', () => {
    mockInitialBuildComplete = false
    mockFirstFileEdit = false
    mockGetItem.mockImplementation((key: string) => (key === 'fbf_shown_app1' ? 'true' : null))
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('shown marker is overridden by a resolved answer (answered wins after refresh)', () => {
    mockInitialBuildComplete = false
    mockGetItem.mockImplementation((key: string) =>
      key === 'fbf_shown_app1' ? 'true' : key === 'fbf_answered_app1' ? 'magical' : null
    )
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })

  it('persists the responded marker when a rating opens a follow-up, keeping it visible in-session', () => {
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.advance('close_followup'))
    expect(mockSetItem).toHaveBeenCalledWith('fbf_responded_app1', 'true')
    expect(result.current?.step).toBe('close_followup')
  })

  it('mount snapshot: a re-render after advance does not hide the follow-up even though the marker reads back', () => {
    // Reflect writes back through reads so the resolve check could "see" the
    // just-written fbf_responded — a live re-read would hide the follow-up; the
    // mount snapshot must not.
    const store: Record<string, string> = {}
    mockGetItem.mockImplementation((key: string) => store[key] ?? null)
    mockSetItem.mockImplementation((key: string, value: string) => {
      store[key] = value
    })

    const { result, rerender } = renderHook(() => useFirstBuildFeedback('app1'))
    act(() => result.current?.advance('close_followup'))
    expect(store['fbf_responded_app1']).toBe('true')

    rerender()
    expect(result.current).not.toBeNull()
    expect(result.current?.step).toBe('close_followup')
  })

  it('does not re-show after refresh once a rating was selected (responded marker persisted)', () => {
    mockInitialBuildComplete = false
    mockGetItem.mockImplementation((key: string) =>
      key === 'fbf_shown_app1' || key === 'fbf_responded_app1' ? 'true' : null
    )
    const { result } = renderHook(() => useFirstBuildFeedback('app1'))
    expect(result.current).toBeNull()
  })
})
