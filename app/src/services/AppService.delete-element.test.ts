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

import { AppService, type ElementDeletePayload } from './AppService'

const payload: ElementDeletePayload = {
  selector: '.hero img',
  preciseSelector: '#root > section:nth-child(1) > img',
  isVideo: false,
  elementInfo: {
    tagName: 'IMG',
    className: 'hero-image',
    id: 'hero',
    dataId: 'abc',
    selector: '.hero img',
    devContext: {
      fileName: 'src/pages/index.tsx',
      componentName: 'Hero',
      lineNumber: 12,
      devId: 'dev-1',
    },
  },
}

describe('AppService.deleteElement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildDynamicApiUrl.mockResolvedValue('https://agent.example.com/apps/app1234567/elements/remove')
    agentFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, message: 'removed', data: { filePath: 'x', changes: {}, commitHash: 'abc1234' } }),
    })
  })

  it('POSTs the mapped element body to the elements/remove route', async () => {
    const service = new AppService()

    const result = await service.deleteElement('app1234567', payload)

    expect(buildDynamicApiUrl).toHaveBeenCalledWith('elements/remove', 'app1234567')
    expect(agentFetch).toHaveBeenCalledWith('https://agent.example.com/apps/app1234567/elements/remove', {
      siteId: 'app1234567',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: payload.selector,
        preciseSelector: payload.preciseSelector,
        isVideo: payload.isVideo,
        elementInfo: payload.elementInfo,
      }),
    })
    expect(result).toEqual({
      success: true,
      message: 'removed',
      data: { filePath: 'x', changes: {}, commitHash: 'abc1234' },
    })
  })

  it('throws when the agents response is not ok', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: 'bad' }),
    })
    const service = new AppService()

    await expect(service.deleteElement('app1234567', payload)).rejects.toThrow(
      'Failed to remove element via API: 400'
    )
  })
})
