/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { appFetch } from './gasket-config'
import { logger } from './request-context'
import { createSiteAndRedirect } from './site-creation'

vi.mock('./gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('./request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('createSiteAndRedirect', () => {
  const mockRouter = {
    push: vi.fn(),
  } as any

  const mockAppFetch = appFetch as Mock

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('validates empty prompt and calls onError', async () => {
    const onError = vi.fn()

    await createSiteAndRedirect(
      {
        prompt: '   ',
        onError,
      },
      mockRouter
    )

    expect(onError).toHaveBeenCalledWith('Prompt cannot be empty')
    expect(mockAppFetch).not.toHaveBeenCalled()
  })

  it('validates prompt byte length and calls onError if too large', async () => {
    const onError = vi.fn()
    const largePrompt = 'a'.repeat(10000) // Exceeds MAX_PROMPT_BYTES

    await createSiteAndRedirect(
      {
        prompt: largePrompt,
        onError,
      },
      mockRouter
    )

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0]).toContain('too large')
    expect(mockAppFetch).not.toHaveBeenCalled()
  })

  it('calls onAuthRequired when API returns 401', async () => {
    const onAuthRequired = vi.fn()
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 401,
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        onAuthRequired,
      },
      mockRouter
    )

    expect(onAuthRequired).toHaveBeenCalledWith('test prompt')
    expect(mockRouter.push).not.toHaveBeenCalled()
  })

  it('calls onError when API returns non-401 error', async () => {
    const onError = vi.fn()
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        onError,
      },
      mockRouter
    )

    expect(onError).toHaveBeenCalledWith('Internal server error')
    expect(mockRouter.push).not.toHaveBeenCalled()
  })

  it('redirects to /develop/[jobId]?type=job for job type response', async () => {
    const onSuccess = vi.fn()
    mockAppFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'job123',
        type: 'job',
        status: 'creating',
        account_id: 'acc123',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        source: 'test',
        onSuccess,
      },
      mockRouter
    )

    expect(onSuccess).toHaveBeenCalledWith('job123', 'job')
    expect(mockRouter.push).toHaveBeenCalledWith('/develop/job123?type=job')
    expect(sessionStorage.getItem('initial-prompt-pending-job123')).toBe('true')
    expect(sessionStorage.getItem('initial-prompt-text-job123')).toBe('test prompt')
    expect(sessionStorage.getItem('name-registration-pending-job123')).toBe('true')
  })

  it('redirects to /develop/[siteId] for site type response', async () => {
    const onSuccess = vi.fn()
    mockAppFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'site456',
        type: 'site',
        status: 'running',
        account_id: 'acc123',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        onSuccess,
      },
      mockRouter
    )

    expect(onSuccess).toHaveBeenCalledWith('site456', 'site')
    expect(mockRouter.push).toHaveBeenCalledWith('/develop/site456')
  })

  it('sets template ID in sessionStorage when provided', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'site789',
        type: 'site',
        status: 'running',
        account_id: 'acc123',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        templateId: 'template-v8',
      },
      mockRouter
    )

    expect(sessionStorage.getItem('initial-template-site789')).toBe('template-v8')
  })

  it('does not set template ID for default template', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'site999',
        type: 'site',
        status: 'running',
        account_id: 'acc123',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        templateId: 'default',
      },
      mockRouter
    )

    expect(sessionStorage.getItem('initial-template-site999')).toBeNull()
  })

  it('logs analytics with correct source', async () => {
    mockAppFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'site000',
        type: 'site',
        status: 'running',
        account_id: 'acc123',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    })

    await createSiteAndRedirect(
      {
        prompt: 'test prompt',
        source: 'create-page',
      },
      mockRouter
    )

    expect(logger.info).toHaveBeenCalledWith(
      'site-creation.start',
      expect.objectContaining({
        source: 'create-page',
      })
    )
  })
})
