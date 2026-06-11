import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@airo/ai-lib', () => ({ getS2SToken: vi.fn(async () => 'test-token') }))

import { logoService } from '../LogoService.js'

describe('LogoService external AbortSignal', () => {
  const originalFetch = global.fetch
  beforeEach(() => { process.env.LOGO_API_URL = 'https://logo.test' })
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks() })

  it('aborts the upstream fetch when the external signal aborts', async () => {
    let capturedSignal: AbortSignal | undefined
    global.fetch = vi.fn((_url: string, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal
      return new Promise(() => {}) // never resolves; the abort is what we assert
    }) as never

    const controller = new AbortController()
    const promise = logoService.generate({
      prompt: 'p', layout: ['square'], appId: 'app-1',
      customerId: 'cust-1', budgetUserId: 'user-1', signal: controller.signal,
    })
    promise.catch(() => {}) // swallow the eventual abort rejection

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(capturedSignal?.aborted).toBe(false)
    controller.abort()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
