/* eslint-disable react-hooks/rules-of-hooks */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { appFetch } from '@/lib/gasket-config'
import { useEvalSnapshotCapture } from './useEvalSnapshotCapture'

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const streamingGetState = vi.fn()
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: () => streamingGetState(),
  },
}))

describe('useEvalSnapshotCapture', function evalSnapshotTests() {
  const appId = 'app-eval-1'
  const buildKey = `airo_eval_snapshot_app_build_count_${appId}`
  const sentKey = `airo_eval_snapshot_sent_${appId}`

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    sessionStorage.clear()
    streamingGetState.mockReturnValue({
      messages: [
        { role: 'user', content: 'Build a todo app' },
        { role: 'assistant', content: 'Done.' },
      ],
    })
    vi.mocked(appFetch).mockResolvedValue(
      new Response(null, { status: 200 }) as Response
    )
    globalThis.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not dispatch when appId is missing', function noAppId() {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useEvalSnapshotCapture({ appId: undefined }))
    sessionStorage.setItem(buildKey, '1')
    act(() => {
      result.current.triggerEvalSnapshot()
    })
    vi.advanceTimersByTime(10_000)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch when build count is not 1', function wrongCount() {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useEvalSnapshotCapture({ appId }))
    sessionStorage.setItem(buildKey, '2')
    act(() => {
      result.current.triggerEvalSnapshot()
    })
    vi.advanceTimersByTime(10_000)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch when snapshot already sent', function alreadySent() {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    sessionStorage.setItem(buildKey, '1')
    sessionStorage.setItem(sentKey, 'true')
    const { result } = renderHook(() => useEvalSnapshotCapture({ appId }))
    act(() => {
      result.current.triggerEvalSnapshot()
    })
    vi.advanceTimersByTime(10_000)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches eval-snapshot-request immediately when count is 1', function dispatches() {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useEvalSnapshotCapture({ appId }))
    sessionStorage.setItem(buildKey, '1')
    act(() => {
      result.current.triggerEvalSnapshot()
    })
    vi.advanceTimersByTime(2000)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const ev = dispatch.mock.calls[0][0] as CustomEvent
    expect(ev.type).toBe('eval-snapshot-request')
  })

  it('resets capture flag when appId changes so new app can receive request', function appSwitch() {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    sessionStorage.setItem(buildKey, '1')
    const otherBuildKey = 'airo_eval_snapshot_app_build_count_app-other'
    sessionStorage.setItem(otherBuildKey, '1')

    const { result, rerender } = renderHook(
      (props: { id: string }) => useEvalSnapshotCapture({ appId: props.id }),
      { initialProps: { id: appId } }
    )
    act(() => {
      result.current.triggerEvalSnapshot()
    })
    vi.advanceTimersByTime(2000)
    expect(dispatch).toHaveBeenCalledTimes(1)

    // Switching apps resets captureRequestedRef so the new app can trigger its own snapshot
    rerender({ id: 'app-other' })
    act(() => {
      result.current.triggerEvalSnapshot()
    })
    vi.advanceTimersByTime(2000)
    expect(dispatch).toHaveBeenCalledTimes(2)
    const ev = dispatch.mock.calls[1][0] as CustomEvent
    expect(ev.type).toBe('eval-snapshot-request')
  })

  it('uploads manifest and screenshot on viewport response', async function upload() {
    const { result } = renderHook(() => useEvalSnapshotCapture({ appId }))
    await act(async () => {
      await result.current.handleEvalViewportScreenshot('data:image/png;base64,xx')
    })
    expect(appFetch).toHaveBeenCalledWith(
      '/api/eval-snapshots',
      expect.objectContaining({ method: 'POST' })
    )
    expect(sessionStorage.getItem(sentKey)).toBe('true')
  })

  it('skips upload when already captured for app', async function skipDup() {
    sessionStorage.setItem(sentKey, 'true')
    const { result } = renderHook(() => useEvalSnapshotCapture({ appId }))
    await act(async () => {
      await result.current.handleEvalViewportScreenshot('data:image/png;base64,xx')
    })
    expect(appFetch).not.toHaveBeenCalled()
  })
})
