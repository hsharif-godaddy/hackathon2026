// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDevToolsBusBindings } from '@/app/[market]/develop/hooks/useDevToolsBusBindings'
import { dispatch } from '@/utils/eventBus'

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: (...a: unknown[]) => fetchMock(...a) }))
vi.mock('@/config/dynamic-api', () => ({ buildDynamicApiUrl: async (p: string) => `/agents/${p}` }))

const handlePreviewRefreshMock = vi.fn()
vi.mock('@/app/[market]/develop/components/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/[market]/develop/components/utils')>()
  return { ...actual, handlePreviewRefresh: (...a: unknown[]) => handlePreviewRefreshMock(...a) }
})

function deps(cmsInlineEditEnabled: boolean) {
  return { appId: 'app1', cmsInlineEditEnabled, lastIframeState: { current: {} } } as never
}
const evt = { type: 'CONTENT_UPDATED', data: { contentKey: 'products[1].name', kind: 'copy', oldText: 'B', newText: 'B2' } }

afterEach(() => {
  fetchMock.mockClear()
  handlePreviewRefreshMock.mockClear()
})

describe('CONTENT_UPDATED bus handler', () => {
  it('forwards to content/edit with value=newText when flag ON', async () => {
    renderHook(() => useDevToolsBusBindings(deps(true)))
    dispatch(evt as never)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, opts] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(opts.body)).toEqual({ contentKey: 'products[1].name', kind: 'copy', value: 'B2' })
  })

  it('does nothing when flag OFF', () => {
    renderHook(() => useDevToolsBusBindings(deps(false)))
    dispatch(evt as never)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls handlePreviewRefresh when fetch resolves with !ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    renderHook(() => useDevToolsBusBindings(deps(true)))
    dispatch(evt as never)
    await vi.waitFor(() => expect(handlePreviewRefreshMock).toHaveBeenCalledTimes(1))
  })

  it('calls handlePreviewRefresh when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'))
    renderHook(() => useDevToolsBusBindings(deps(true)))
    dispatch(evt as never)
    await vi.waitFor(() => expect(handlePreviewRefreshMock).toHaveBeenCalledTimes(1))
  })
})
