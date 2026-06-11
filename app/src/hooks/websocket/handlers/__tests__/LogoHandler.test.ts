import { beforeEach,describe, expect, it, vi } from 'vitest'

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }))
vi.mock('@/hooks/shared/logoNotification', () => ({ handleLogoNotification: mockHandle }))

import { LogoHandler } from '../LogoHandler'

beforeEach(() => vi.clearAllMocks())

describe('LogoHandler', () => {
  it('has type "logo"', () => { expect(new LogoHandler().type).toBe('logo') })

  it('delegates to handleLogoNotification with the message data + app context', async () => {
    const handler = new LogoHandler()
    await handler.handle(
      { type: 'logo', content: '', data: { status: 'completed', jobId: 'job-1', slots: ['logo/horizontal'] } },
      { currentAppId: 'app-1', t: (id: string) => id } as never,
    )
    expect(mockHandle).toHaveBeenCalledWith(expect.objectContaining({
      raw: { status: 'completed', jobId: 'job-1', slots: ['logo/horizontal'] },
      clientAppId: 'app-1', logPrefix: 'logo.websocket',
    }))
  })
})
