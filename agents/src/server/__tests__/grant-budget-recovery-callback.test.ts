import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGrantBudgetRecoveryCallback } from '../grant-budget-recovery-callback.js'

vi.mock('@airo/ai-grants', () => ({
  grantSessionManager: {
    advanceToNextGrant: vi.fn(),
    getCurrentUserId: vi.fn(),
    requestGrantRefreshAndWait: vi.fn(),
  },
}))

vi.mock('@airo/ai-transport', () => ({
  hasNonIdempotentTools: vi.fn((names: string[]) => names.includes('git__commit')),
}))

import { grantSessionManager } from '@airo/ai-grants'

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

describe('createGrantBudgetRecoveryCallback', () => {
  const sessionId = 'sse:test-conv-123'
  const error = new Error('budget exceeded')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns retry with newUserId on successful local advance', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('new-user-456')

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, ['read_file'])

    expect(result).toEqual({ retry: true, newUserId: 'new-user-456', hasNonIdempotentTools: false })
    expect(mockLogger.info).toHaveBeenCalledWith('grants.mid_stream.advanced', expect.objectContaining({
      sessionId, newUserId: 'new-user-456',
    }))
    expect(grantSessionManager.requestGrantRefreshAndWait).not.toHaveBeenCalled()
  })

  it('falls through to refresh when advance succeeds but getCurrentUserId returns null', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)
    vi.mocked(grantSessionManager.getCurrentUserId)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('refreshed-user-789')
    vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(true)

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, [])

    expect(result).toEqual({ retry: true, newUserId: 'refreshed-user-789', hasNonIdempotentTools: false })
    expect(mockLogger.warn).toHaveBeenCalledWith('grants.mid_stream.advanced_but_no_userid', { sessionId })
    expect(mockLogger.info).toHaveBeenCalledWith('grants.mid_stream.refresh_advanced', expect.objectContaining({
      sessionId, newUserId: 'refreshed-user-789',
    }))
  })

  it('returns retry with newUserId on successful refresh (advance failed)', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(false)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('refresh-user-111')
    vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(true)

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, [])

    expect(result).toEqual({ retry: true, newUserId: 'refresh-user-111', hasNonIdempotentTools: false })
    expect(mockLogger.info).toHaveBeenCalledWith('grants.mid_stream.refresh_advanced', expect.objectContaining({ sessionId }))
  })

  it('returns retry:false when refresh succeeds but getCurrentUserId returns null', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(false)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue(null)
    vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(true)

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, [])

    expect(result).toEqual({ retry: false, hasNonIdempotentTools: false })
    expect(mockLogger.warn).toHaveBeenCalledWith('grants.mid_stream.refresh_but_no_userid', { sessionId })
    expect(mockLogger.warn).toHaveBeenCalledWith('grants.mid_stream.all_exhausted', expect.objectContaining({ sessionId }))
  })

  it('returns retry:false when all grants exhausted', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(false)
    vi.mocked(grantSessionManager.requestGrantRefreshAndWait).mockResolvedValue(false)

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, ['git__commit'])

    expect(result).toEqual({ retry: false, hasNonIdempotentTools: true })
    expect(mockLogger.warn).toHaveBeenCalledWith('grants.mid_stream.all_exhausted', expect.objectContaining({ sessionId }))
  })

  it('returns retry:false on internal error and logs at error level', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockImplementation(() => { throw new Error('DB failure') })

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, [])

    expect(result).toEqual({ retry: false, hasNonIdempotentTools: false })
    expect(mockLogger.error).toHaveBeenCalledWith('grants.mid_stream.callback_internal_error', expect.objectContaining({
      sessionId, error: 'DB failure',
    }))
  })

  it('propagates hasNonIdempotentTools based on executed tool names', async () => {
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('user-x')

    const callback = createGrantBudgetRecoveryCallback({ logger: mockLogger })
    const result = await callback(sessionId, error, ['git__commit', 'read_file'])

    expect(result.hasNonIdempotentTools).toBe(true)
  })
})
