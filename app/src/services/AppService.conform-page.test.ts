import { beforeEach, describe, expect, it, vi } from 'vitest'

const { agentFetch, buildDynamicApiUrl } = vi.hoisted(() => ({
  agentFetch: vi.fn(),
  buildDynamicApiUrl: vi.fn(),
}))

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicApiUrl,
}))

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch,
}))

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: { getState: () => ({}) },
}))

import { AppService } from './AppService'

describe('AppService.conformPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildDynamicApiUrl.mockResolvedValue('https://agent.example.com/apps/app1234567/content/conform-page')
  })

  it('calls the correct endpoint and returns ok + applied on success', async () => {
    agentFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, applied: true }),
    })

    const service = new AppService()
    const result = await service.conformPage('app1234567', { page: 'src/pages/index.tsx' })

    expect(buildDynamicApiUrl).toHaveBeenCalledWith('content/conform-page', 'app1234567')
    expect(agentFetch).toHaveBeenCalledWith(
      'https://agent.example.com/apps/app1234567/content/conform-page',
      {
        siteId: 'app1234567',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'src/pages/index.tsx' }),
      },
    )
    expect(result).toEqual({ ok: true, applied: true })
  })

  it('returns { ok: false } on a non-2xx response', async () => {
    agentFetch.mockResolvedValue({ ok: false, status: 400 })

    const service = new AppService()
    const result = await service.conformPage('app1234567', { page: 'src/pages/index.tsx' })

    expect(result).toEqual({ ok: false })
  })

  it('returns { ok: true, applied: false } when nothing was conformed', async () => {
    agentFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, applied: false }),
    })

    const service = new AppService()
    const result = await service.conformPage('app1234567', { page: 'src/pages/about.tsx' })

    expect(result).toEqual({ ok: true, applied: false })
  })
})
