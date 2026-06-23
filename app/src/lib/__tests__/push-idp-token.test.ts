import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSwitchboardFlag, mockLogger, mockFetch } = vi.hoisted(() => ({
  mockGetSwitchboardFlag: vi.fn(),
  mockLogger: { warn: vi.fn() },
  mockFetch: vi.fn(),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  getSwitchboardFlag: mockGetSwitchboardFlag,
}))

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}))

import { pushIdpToken } from '../push-idp-token'

describe('pushIdpToken', function pushIdpTokenTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(function teardown() {
    vi.unstubAllGlobals()
  })

  it('reads the correct switchboard flag name', async function flagName() {
    mockGetSwitchboardFlag.mockReturnValue(false)
    await pushIdpToken('app-1', 'conv-1')
    expect(mockGetSwitchboardFlag).toHaveBeenCalledWith('airo-builder-care-agent-enabled')
  })

  it('does nothing when care-agent flag is off', async function flagOff() {
    mockGetSwitchboardFlag.mockReturnValue(false)
    await pushIdpToken('app-1', 'conv-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does nothing when care-agent flag is undefined', async function flagUndefined() {
    mockGetSwitchboardFlag.mockReturnValue(undefined)
    await pushIdpToken('app-1', 'conv-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('POSTs to /api/auth/idp-token with appId and conversationId when flag is on', async function posts() {
    mockGetSwitchboardFlag.mockReturnValue(true)
    await pushIdpToken('app-1', 'conv-1')
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/idp-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'app-1', conversationId: 'conv-1' }),
    })
  })

  it('logs warn with status when response is not ok', async function failedResponse() {
    mockGetSwitchboardFlag.mockReturnValue(true)
    mockFetch.mockResolvedValue({ ok: false, status: 401 })
    await pushIdpToken('app-1', 'conv-1')
    expect(mockLogger.warn).toHaveBeenCalledWith('care.idp_token_push.failed', {
      appId: 'app-1',
      conversationId: 'conv-1',
      status: 401,
    })
  })

  it('logs warn with error message on network failure', async function networkError() {
    mockGetSwitchboardFlag.mockReturnValue(true)
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await pushIdpToken('app-1', 'conv-1')
    expect(mockLogger.warn).toHaveBeenCalledWith('care.idp_token_push.error', {
      appId: 'app-1',
      conversationId: 'conv-1',
      error: 'ECONNREFUSED',
    })
  })

  it('logs warn with stringified non-Error on network failure', async function nonErrorRejection() {
    mockGetSwitchboardFlag.mockReturnValue(true)
    mockFetch.mockRejectedValue('timeout')
    await pushIdpToken('app-1', 'conv-1')
    expect(mockLogger.warn).toHaveBeenCalledWith('care.idp_token_push.error', {
      appId: 'app-1',
      conversationId: 'conv-1',
      error: 'timeout',
    })
  })

  it('does not log on successful push', async function successNoLog() {
    mockGetSwitchboardFlag.mockReturnValue(true)
    await pushIdpToken('app-1', 'conv-1')
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
