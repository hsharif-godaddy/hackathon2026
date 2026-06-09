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

describe('AppService.updateFormatOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildDynamicApiUrl.mockResolvedValue('https://agent.example.com/apps/app1234567/format-overrides')
    agentFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, commitHash: 'abc1234' }),
    })
  })

  it('omits transport commitId from the agents route payload', async () => {
    const service = new AppService()

    await service.updateFormatOverride('app1234567', {
      commitId: 'commit-123',
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true, italic: false, color: null },
    })

    expect(buildDynamicApiUrl).toHaveBeenCalledWith('format-overrides', 'app1234567')
    expect(agentFetch).toHaveBeenCalledWith('https://agent.example.com/apps/app1234567/format-overrides', {
      siteId: 'app1234567',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          contentKey: null,
          contentKeyTemplate: null,
          expressionHash: `sha256:${'a'.repeat(64)}`,
        },
        marks: { bold: true, italic: false, color: null },
      }),
    })
  })

  it('surfaces agents validation error messages', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: 'expressionHash is required' }),
    })
    const service = new AppService()

    await expect(service.updateFormatOverride('app1234567', {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
      },
      marks: { bold: true },
    })).rejects.toThrow('expressionHash is required')
  })

  it('uses a status fallback when the agents error body has no message', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ error: { message: 'bad gateway' } }),
    })
    const service = new AppService()

    await expect(service.updateFormatOverride('app1234567', {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true },
    })).rejects.toThrow('Failed to send format override update to API: 502')
  })

  it('returns a failure result when a successful agents response is malformed', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'ok' }),
    })
    const service = new AppService()

    await expect(service.updateFormatOverride('app1234567', {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true },
    })).resolves.toEqual({
      success: false,
      error: 'Format override update failed',
    })
  })
})
