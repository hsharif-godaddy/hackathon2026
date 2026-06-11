import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
const mockCancel = vi.fn(async () => ({ cancelled: true }))
vi.mock('../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { cancel: mockCancel },
}))

const { handleCancelLogoGeneration } = await import('../logo-cancel-handler.js')

const socketWith = (siteId?: string) => ({ id: 'sock-1', handshake: { auth: { agentContext: { siteId } } } })

beforeEach(() => { vi.clearAllMocks(); mockCancel.mockResolvedValue({ cancelled: true }) })

describe('handleCancelLogoGeneration', () => {
  it('cancels the authenticated app job and acks', async () => {
    const ack = vi.fn()
    await handleCancelLogoGeneration(socketWith('app-1'), { jobId: 'job-1' }, ack)
    expect(mockCancel).toHaveBeenCalledWith('app-1', 'job-1')
    expect(ack).toHaveBeenCalledWith({ success: true, cancelled: true })
  })

  it('acks an error when the socket has no authenticated siteId', async () => {
    const ack = vi.fn()
    await handleCancelLogoGeneration(socketWith(undefined), { jobId: 'job-1' }, ack)
    expect(mockCancel).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledWith({ error: 'Authentication context missing' })
  })
})
