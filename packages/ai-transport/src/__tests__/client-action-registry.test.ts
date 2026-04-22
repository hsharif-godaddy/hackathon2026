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
    const sendRequest = vi.fn().mockImplementation(() => { throw new Error('send failed') })
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
})
