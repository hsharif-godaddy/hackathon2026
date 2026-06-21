import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAppMock = vi.fn()
const getSSERegistryMock = vi.fn()

vi.mock('../sse/registry-singleton.js', () => ({
  getSSERegistry: () => getSSERegistryMock(),
}))

describe('emitOAuthResult', () => {
  beforeEach(() => {
    vi.resetModules()
    sendToAppMock.mockReset()
    getSSERegistryMock.mockReset().mockReturnValue({ sendToApp: sendToAppMock })
  })

  it('delivers success payload to SSE (oauth_result)', async () => {
    const payload = {
      success: true as const,
      appId: 'app-1',
      state: 'state-1',
      provider: 'godaddy',
      expiresAt: 1234,
      scopes: ['commerce.product:read'],
    }
    const { emitOAuthResult } = await import('../oauth-emit.js')
    emitOAuthResult(payload)

    expect(sendToAppMock).toHaveBeenCalledWith('app-1', 'oauth_result', payload)
  })

  it('delivers failure payload (success: false with error/description) over SSE', async () => {
    const payload = {
      success: false,
      appId: 'app-2',
      state: 'state-2',
      provider: 'godaddy',
      error: 'exchange_failed',
      description: 'HTTP 500',
    }
    const { emitOAuthResult } = await import('../oauth-emit.js')
    emitOAuthResult(payload)

    expect(sendToAppMock).toHaveBeenCalledWith('app-2', 'oauth_result', payload)
  })

  it('skips SSE emit when registry is not initialized', async () => {
    getSSERegistryMock.mockReturnValue(null)
    const { emitOAuthResult } = await import('../oauth-emit.js')
    emitOAuthResult({
      success: true,
      appId: 'app-1',
      state: 'state-1',
      provider: 'godaddy',
    })

    expect(sendToAppMock).not.toHaveBeenCalled()
  })
})
