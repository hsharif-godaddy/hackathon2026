import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@airo/shared/chat', () => ({
  isRestoreMetadata: vi.fn(function isRestoreMetadata() { return false }),
}))

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

describe('AppService.updateText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildDynamicApiUrl.mockResolvedValue('https://agent.example.com/apps/app1234567/text/edit')
  })

  it('preserves unsupported dynamic text codes from agents', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Failed to edit text',
        code: 'UNSUPPORTED_DYNAMIC_TEXT_CONTENT',
      }),
    })
    const service = new AppService()

    await expect(service.updateText('app1234567', {
      selector: 'h1',
      oldText: 'Welcome',
      newText: 'Hello',
      devContext: {
        fileName: 'src/pages/index.tsx',
        componentName: 'Home',
        lineNumber: 4,
        devId: '0270ce',
      },
    })).resolves.toMatchObject({
      code: 'UNSUPPORTED_DYNAMIC_TEXT_CONTENT',
    })
  })

  it('throws unknown typed non-ok responses', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Failed to edit text',
        code: 'SOME_FUTURE_CODE',
      }),
    })
    const service = new AppService()

    await expect(service.updateText('app1234567', {
      selector: 'h1',
      oldText: 'Welcome',
      newText: 'Hello',
    })).rejects.toThrow('Failed to send text update to API: 400: Failed to edit text')
  })

  it('throws generic non-ok responses without typed edit failure codes', async () => {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        error: 'Internal server error',
      }),
    })
    const service = new AppService()

    await expect(service.updateText('app1234567', {
      selector: 'h1',
      oldText: 'Welcome',
      newText: 'Hello',
    })).rejects.toThrow('Failed to send text update to API: 500: Internal server error')
  })
})
