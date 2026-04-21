/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { appFetch } from '@/lib/gasket-config'
import { usePublishSnapshotCapture } from './usePublishSnapshotCapture'

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

describe('usePublishSnapshotCapture', function publishSnapshotTests() {
  const detail = {
    appId: 'app-123',
    deploymentId: 'deploy-abc',
    commitHash: 'abc1234def5678',
  }

  beforeEach(function setup() {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(appFetch).mockResolvedValue(new Response(null, { status: 200 }) as Response)
    globalThis.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['img'], { type: 'image/png' })),
    }) as unknown as typeof fetch
  })

  afterEach(function teardown() {
    vi.useRealTimers()
  })

  it('calls POST /api/publish-snapshots with formData on success', async function uploadsSnapshot() {
    const { result } = renderHook(() => usePublishSnapshotCapture())
    await act(async () => {
      await result.current.upload('data:image/png;base64,xx', detail)
    })
    expect(appFetch).toHaveBeenCalledWith(
      '/api/apps/app-123/publish-snapshots',
      expect.objectContaining({ method: 'POST' })
    )
    const [, options] = vi.mocked(appFetch).mock.calls[0]
    expect(options?.body).toBeInstanceOf(FormData)
    const fd = options?.body as FormData
    expect(fd.get('key')).toBe('deploy-abc')
  })

  it('uses commitHash fallback key when deploymentId is undefined', async function fallbackKey() {
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const { result } = renderHook(() => usePublishSnapshotCapture())
    await act(async () => {
      await result.current.upload('data:image/png;base64,xx', {
        ...detail,
        deploymentId: undefined,
      })
    })
    const [, options] = vi.mocked(appFetch).mock.calls[0]
    const fd = options?.body as FormData
    expect(fd.get('key')).toBe(`${detail.commitHash}-${Date.now()}`)
  })

  it('logs warn and does not throw when appFetch fails', async function handlesError() {
    const { logger } = await import('@/lib/request-context')
    vi.mocked(appFetch).mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => usePublishSnapshotCapture())
    await act(async () => {
      await result.current.upload('data:image/png;base64,xx', detail)
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'publish-snapshots.upload.failure',
      expect.objectContaining({ appId: 'app-123', error: 'network error' })
    )
  })

  it('logs warn when upload response is not ok', async function handlesNotOk() {
    const { logger } = await import('@/lib/request-context')
    vi.mocked(appFetch).mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Server Error' }) as Response
    )
    const { result } = renderHook(() => usePublishSnapshotCapture())
    await act(async () => {
      await result.current.upload('data:image/png;base64,xx', detail)
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'publish-snapshots.upload.failure',
      expect.objectContaining({ appId: 'app-123' })
    )
  })
})
