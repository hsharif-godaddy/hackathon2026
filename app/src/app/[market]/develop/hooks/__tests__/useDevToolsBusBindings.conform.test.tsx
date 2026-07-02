// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDevToolsBusBindings } from '@/app/[market]/develop/hooks/useDevToolsBusBindings'
import { dispatch } from '@/utils/eventBus'

const { conformPageMock, postMessageToIframeMock } = vi.hoisted(() => ({
  conformPageMock: vi.fn(),
  postMessageToIframeMock: vi.fn(),
}))

vi.mock('@/services/AppService', () => ({ appService: { conformPage: conformPageMock } }))
vi.mock('@/utils/postMessage', () => ({ postMessageToIframe: (...a: unknown[]) => postMessageToIframeMock(...a) }))

// Silence logger noise
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

type T = (key: string, values?: unknown, fallback?: string) => string
const defaultT: T = (key, _values, fallback) => fallback ?? key

function deps(t: T = defaultT) {
  return { appId: 'app-test', cmsInlineEditEnabled: false, lastIframeState: { current: {} }, t } as never
}

const conformEvt = { type: 'CONFORM_REQUEST', data: { page: 'src/pages/index.tsx', arrayName: 'features' }, requestId: 'req-test-1' }

beforeEach(() => {
  const iframe: HTMLIFrameElement = document.createElement('iframe')
  iframe.id = 'preview-iframe'
  document.body.appendChild(iframe)
})

afterEach(() => {
  conformPageMock.mockReset()
  postMessageToIframeMock.mockClear()
  document.getElementById('preview-iframe')?.remove()
})

describe('CONFORM_REQUEST bus handler — iframe resolved after await', () => {
  it('posts CONFORM_SUCCEEDED with iframe resolved post-await (iframe present at reply time)', async () => {
    // Removes iframe before dispatch, re-inserts during the await so it is
    // absent at dispatch time but present when the reply is sent.
    document.getElementById('preview-iframe')?.remove()
    conformPageMock.mockImplementation(async () => {
      const iframe: HTMLIFrameElement = document.createElement('iframe')
      iframe.id = 'preview-iframe'
      document.body.appendChild(iframe)
      return { ok: true, applied: true }
    })
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const types: string[] = postMessageToIframeMock.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toContain('CONFORM_SUCCEEDED')
  })

  it('does not hang when iframe is absent at reply time (no post, no throw)', async () => {
    // Removes iframe so it is absent both before AND after the await.
    // The handler must not throw and must complete (pendingConform clears).
    document.getElementById('preview-iframe')?.remove()
    conformPageMock.mockResolvedValueOnce({ ok: true, applied: true })
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    // Give the async handler time to complete
    await vi.waitFor(() => expect(conformPageMock).toHaveBeenCalled())
    await Promise.resolve()
    // postMessageToIframe must NOT have been called (no iframe to post to)
    expect(postMessageToIframeMock).not.toHaveBeenCalled()
  })
})

describe('CONFORM_REQUEST bus handler', () => {
  it('posts CONFORM_SUCCEEDED when conformPage returns ok=true and applied=true', async () => {
    conformPageMock.mockResolvedValueOnce({ ok: true, applied: true })
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const types: string[] = postMessageToIframeMock.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toContain('CONFORM_SUCCEEDED')
    expect(types).not.toContain('CONFORM_FAILED')
  })

  it('posts CONFORM_FAILED when conformPage returns ok=true but applied=false', async () => {
    conformPageMock.mockResolvedValueOnce({ ok: true, applied: false })
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const types: string[] = postMessageToIframeMock.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toContain('CONFORM_FAILED')
    expect(types).not.toContain('CONFORM_SUCCEEDED')
  })

  it('posts CONFORM_FAILED when conformPage returns ok=false', async () => {
    conformPageMock.mockResolvedValueOnce({ ok: false })
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const types: string[] = postMessageToIframeMock.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toContain('CONFORM_FAILED')
    expect(types).not.toContain('CONFORM_SUCCEEDED')
  })

  it('posts CONFORM_FAILED when conformPage throws', async () => {
    conformPageMock.mockRejectedValueOnce(new Error('network error'))
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const types: string[] = postMessageToIframeMock.mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toContain('CONFORM_FAILED')
    expect(types).not.toContain('CONFORM_SUCCEEDED')
  })
})

describe('CONFORM_REQUEST bus handler — requestId threading', () => {
  it('echoes requestId on CONFORM_SUCCEEDED reply', async () => {
    conformPageMock.mockResolvedValueOnce({ ok: true, applied: true })
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const payloads: { type: string; requestId?: string }[] = postMessageToIframeMock.mock.calls.map(
      (c) => c[1] as { type: string; requestId?: string },
    )
    const succeeded = payloads.find((p) => p.type === 'CONFORM_SUCCEEDED')
    expect(succeeded?.requestId).toBe('req-test-1')
  })

  it('echoes requestId on CONFORM_FAILED reply (throws path)', async () => {
    conformPageMock.mockRejectedValueOnce(new Error('oops'))
    renderHook(() => useDevToolsBusBindings(deps()))
    dispatch(conformEvt as never)
    await vi.waitFor(() => expect(postMessageToIframeMock).toHaveBeenCalled())
    const payloads: { type: string; requestId?: string }[] = postMessageToIframeMock.mock.calls.map(
      (c) => c[1] as { type: string; requestId?: string },
    )
    const failed = payloads.find((p) => p.type === 'CONFORM_FAILED')
    expect(failed?.requestId).toBe('req-test-1')
  })
})
