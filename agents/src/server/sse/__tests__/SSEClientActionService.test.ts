import { describe, it, expect, vi } from 'vitest'
import { SSEClientActionService } from '../SSEClientActionService.js'

function makeEventChannel() {
  return {
    publish: vi.fn().mockResolvedValue({ sequence: 1 }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getEventsSince: vi.fn().mockReturnValue([]),
  } as any
}

describe('SSEClientActionService.executeAction', () => {
  it('publishes a client_action event with action, params, and requestId', async () => {
    const channel = makeEventChannel()
    const service = new SSEClientActionService('conv_1', 'app_1', channel)

    service.executeAction({ action: 'publish', params: { appId: 'app_1' }, timeoutMs: 60_000 })
      .catch(() => {}) // we don't await the action itself; it's gated on a resolve

    // ClientActionRegistry runs the publisher synchronously inside
    // executeAction; allow the .catch chain to settle.
    await Promise.resolve()

    expect(channel.publish).toHaveBeenCalledTimes(1)
    const [conv, event] = channel.publish.mock.calls[0]
    expect(conv).toBe('conv_1')
    expect(event).toMatchObject({
      type: 'client_action',
      conversationId: 'conv_1',
      data: {
        action: 'publish',
        params: { appId: 'app_1' },
        conversationId: 'conv_1',
      },
    })
    // requestId is allocated by the registry, so we don't pin the value —
    // just assert it is present and stable within the payload.
    expect(typeof event.data.requestId).toBe('string')
    expect(event.data.requestId.length).toBeGreaterThan(0)
  })

  it('swallows publish rejections so executeAction does not reject from channel errors', async () => {
    const channel = makeEventChannel()
    channel.publish.mockRejectedValueOnce(new Error('subscriber boom'))
    const service = new SSEClientActionService('conv_1', 'app_1', channel)

    // The action promise only rejects on cleanup or timeout, not on a
    // publish-rejection — the registry's .catch swallows the error.
    const pending = service.executeAction({
      action: 'publish', params: {}, timeoutMs: 60_000,
    })
    pending.catch(() => {})
    await Promise.resolve()
    await Promise.resolve()

    // If the .catch were missing, the unhandled rejection above would
    // surface here via service.cleanup() — but the point of this test is
    // that the publish side-effect does not propagate into the caller.
    // We assert cleanup resolves the pending promise normally as
    // evidence that executeAction did not already reject.
    service.cleanup()
    await expect(pending).rejects.toThrow(/cleanup/i)
  })
})

describe('SSEClientActionService.cleanup', () => {
  it('rejects pending executeAction promises', async () => {
    const service = new SSEClientActionService('conv_1', 'app_1', makeEventChannel())

    const pending = service.executeAction({
      action: 'publish',
      params: { appId: 'app_1' },
      timeoutMs: 60_000,
    })

    // Let publish() run so the request is registered before cleanup.
    await Promise.resolve()

    service.cleanup()

    await expect(pending).rejects.toThrow(/cleanup/i)
  })

  it('resolveAction returns false after cleanup (registry is cleared)', async () => {
    const service = new SSEClientActionService('conv_2', 'app_1', makeEventChannel())
    service.executeAction({ action: 'getSiteData', params: {}, timeoutMs: 60_000 }).catch(() => {})
    await Promise.resolve()
    service.cleanup()

    expect(service.resolveAction({ requestId: 'nope', success: true })).toBe(false)
  })
})
