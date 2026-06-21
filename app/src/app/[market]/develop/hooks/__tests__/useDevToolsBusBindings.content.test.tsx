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

const addGrowlMessageMock = vi.fn()
vi.mock('@ux/growl', () => ({ default: { addGrowlMessage: (...a: unknown[]) => addGrowlMessageMock(...a) } }))

type T = (key: string, values?: unknown, fallback?: string) => string
const defaultT: T = (key, _values, fallback) => fallback ?? key

function deps(cmsInlineEditEnabled: boolean, t: T = defaultT) {
  return { appId: 'app1', cmsInlineEditEnabled, lastIframeState: { current: {} }, t } as never
}
const evt = { type: 'CONTENT_UPDATED', data: { contentKey: 'products[1].name', kind: 'copy', oldText: 'B', newText: 'B2' } }

afterEach(() => {
  fetchMock.mockClear()
  handlePreviewRefreshMock.mockClear()
  addGrowlMessageMock.mockClear()
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

  it('reverts and shows a rejection toast when fetch resolves with !ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 'invalid-value' } }) })
    renderHook(() => useDevToolsBusBindings(deps(true)))
    dispatch(evt as never)
    await vi.waitFor(() => expect(handlePreviewRefreshMock).toHaveBeenCalledTimes(1))
    expect(addGrowlMessageMock).toHaveBeenCalledTimes(1)
    expect(addGrowlMessageMock.mock.calls[0][0]).toMatchObject({ emphasis: 'critical' })
  })

  it('reverts and shows a toast when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'))
    renderHook(() => useDevToolsBusBindings(deps(true)))
    dispatch(evt as never)
    await vi.waitFor(() => expect(handlePreviewRefreshMock).toHaveBeenCalledTimes(1))
    expect(addGrowlMessageMock).toHaveBeenCalledTimes(1)
  })

  it('still reverts when the toast itself throws (toast is best-effort)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 'invalid-value' } }) })
    const throwingT: T = () => {
      throw new Error('t boom')
    }
    renderHook(() => useDevToolsBusBindings(deps(true, throwingT)))
    dispatch(evt as never)
    await vi.waitFor(() => expect(handlePreviewRefreshMock).toHaveBeenCalledTimes(1))
  })
})
