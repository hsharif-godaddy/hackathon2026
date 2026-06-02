import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClientActionRegistry } from '../client-action-registry.js'

describe('ClientActionRegistry', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('resolves when action result arrives', async () => {
    const sendRequest = vi.fn()
    const registry = new ClientActionRegistry(sendRequest)

    const promise = registry.executeAction({ action: 'auth', params: {} })
    const requestId = sendRequest.mock.calls[0][0].requestId

    registry.resolveAction(requestId, { success: true, result: { token: 'abc' } })

    await expect(promise).resolves.toEqual({ success: true, result: { token: 'abc' } })
  })

  it('rejects on timeout', async () => {
    const sendRequest = vi.fn()
    const registry = new ClientActionRegistry(sendRequest)

    const promise = registry.executeAction({ action: 'auth', params: {}, timeoutMs: 5000 })

    vi.advanceTimersByTime(5001)

    await expect(promise).rejects.toThrow('Client action timed out')
  })

  it('returns false for unknown requestId', () => {
    const registry = new ClientActionRegistry(vi.fn())
    expect(registry.resolveAction('unknown', { success: true })).toBe(false)
  })

  it('rejects duplicate requestId', async () => {
    const sendRequest = vi.fn()
    const registry = new ClientActionRegistry(sendRequest)

    registry.executeAction({ action: 'a', params: {}, requestId: 'dup' })
    await expect(registry.executeAction({ action: 'b', params: {}, requestId: 'dup' }))
      .rejects.toThrow('Duplicate requestId')
  })

  it('rejects immediately if sendRequest throws', async () => {
    const sendRequest = vi.fn().mockImplementation(function () { throw new Error('send failed') })
    const registry = new ClientActionRegistry(sendRequest)

    await expect(registry.executeAction({ action: 'a', params: {} }))
      .rejects.toThrow('send failed')
  })

  it('cleans up all pending requests', async () => {
    const sendRequest = vi.fn()
    const registry = new ClientActionRegistry(sendRequest)

    const p1 = registry.executeAction({ action: 'a', params: {} })
    const p2 = registry.executeAction({ action: 'b', params: {} })

    registry.cleanup()

    await expect(p1).rejects.toThrow('cleanup')
    await expect(p2).rejects.toThrow('cleanup')
  })

  describe('resetTimeout', () => {
    it('returns false for unknown requestId', () => {
      const registry = new ClientActionRegistry(vi.fn())
      expect(registry.resetTimeout('nonexistent')).toBe(false)
    })

    it('falls back to original timeoutMs when newTimeoutMs not provided', async () => {
      const sendRequest = vi.fn()
      const registry = new ClientActionRegistry(sendRequest)

      const promise = registry.executeAction({ action: 'pub', params: {}, timeoutMs: 60000 })
      const requestId = sendRequest.mock.calls[0][0].requestId

      vi.advanceTimersByTime(25000)
      expect(registry.resetTimeout(requestId)).toBe(true)

      // Original timeout was 60s, reset at 25s — new timeout fires at 25s + 60s = 85s
      vi.advanceTimersByTime(59999)
      // Not yet timed out
      expect(registry.getPendingRequestIds()).toContain(requestId)

      vi.advanceTimersByTime(2)
      await expect(promise).rejects.toThrow('timed out after 60000ms')
    })

    it('uses newTimeoutMs when provided', async () => {
      const sendRequest = vi.fn()
      const registry = new ClientActionRegistry(sendRequest)

      const promise = registry.executeAction({ action: 'pub', params: {}, timeoutMs: 60000 })
      const requestId = sendRequest.mock.calls[0][0].requestId

      expect(registry.resetTimeout(requestId, 5000)).toBe(true)

      vi.advanceTimersByTime(5001)
      await expect(promise).rejects.toThrow('timed out after 5000ms')
    })

    it('returns false after the entry has been resolved', () => {
      const sendRequest = vi.fn()
      const registry = new ClientActionRegistry(sendRequest)

      registry.executeAction({ action: 'a', params: {} })
      const requestId = sendRequest.mock.calls[0][0].requestId

      registry.resolveAction(requestId, { success: true })
      expect(registry.resetTimeout(requestId)).toBe(false)
    })
  })

  describe('getPendingRequestIds', () => {
    it('returns empty array with no pending actions', () => {
      const registry = new ClientActionRegistry(vi.fn())
      expect(registry.getPendingRequestIds()).toEqual([])
    })

    it('returns all pending request IDs', () => {
      const sendRequest = vi.fn()
      const registry = new ClientActionRegistry(sendRequest)

      registry.executeAction({ action: 'a', params: {}, requestId: 'req-1' })
      registry.executeAction({ action: 'b', params: {}, requestId: 'req-2' })

      expect(registry.getPendingRequestIds()).toEqual(['req-1', 'req-2'])
    })

    it('excludes resolved requests', () => {
      const sendRequest = vi.fn()
      const registry = new ClientActionRegistry(sendRequest)

      registry.executeAction({ action: 'a', params: {}, requestId: 'req-1' })
      registry.executeAction({ action: 'b', params: {}, requestId: 'req-2' })

      registry.resolveAction('req-1', { success: true })

      expect(registry.getPendingRequestIds()).toEqual(['req-2'])
    })
  })
})
