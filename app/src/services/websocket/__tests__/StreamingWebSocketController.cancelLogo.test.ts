import { beforeEach,describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } })) // match the file's logger import

import { StreamingWebSocketController } from '../StreamingWebSocketController'

describe('StreamingWebSocketController.cancelLogoGeneration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits cancel_logo_generation with the jobId and resolves cancelled', async () => {
    let captured: { event?: string; data?: unknown } = {}
    const fakeSocket = {
      connected: true,
      emit: (event: string, data: unknown, ack: (r: unknown) => void) => {
        captured = { event, data }
        ack({ success: true, cancelled: true })
      },
    }
    const c = Object.create(StreamingWebSocketController.prototype) as StreamingWebSocketController
    ;(c as unknown as { supervisor: unknown }).supervisor = { getSocket: () => fakeSocket }

    const result = await c.cancelLogoGeneration('job-1')
    expect(captured.event).toBe('cancel_logo_generation')
    expect(captured.data).toEqual({ jobId: 'job-1' })
    expect(result).toEqual({ cancelled: true })
  })

  it('resolves cancelled:false when the socket is disconnected', async () => {
    const c = Object.create(StreamingWebSocketController.prototype) as StreamingWebSocketController
    ;(c as unknown as { supervisor: unknown }).supervisor = { getSocket: () => null }
    expect(await c.cancelLogoGeneration('job-1')).toEqual({ cancelled: false })
  })
})
