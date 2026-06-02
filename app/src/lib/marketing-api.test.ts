import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scheduleInstagramPost } from './marketing-api'

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: vi.fn(function () { return 'godaddy.com'; })
}))

describe('scheduleInstagramPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('calls marketing API with correct payload', async () => {
    const mockResponse = {
      message: 'Post scheduled successfully!',
      jobId: 'test-job-123',
      scheduleTime: '2026-02-15T14:30:00Z'
    }

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    })

    const params = {
      socialId: 'instagram-account-123',
      images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
      message: 'Test post caption',
      scheduleTime: '2026-02-15T14:30:00Z'
    }

    await scheduleInstagramPost(params)

    expect(global.fetch).toHaveBeenCalledWith(
      'https://marketing.api.godaddy.com/v1/instagram/createPost',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          socialId: params.socialId,
          payload: {
            images: [
              { src: 'https://example.com/image1.jpg' },
              { src: 'https://example.com/image2.jpg' }
            ],
            message: params.message,
            scheduleTime: params.scheduleTime
          }
        })
      }
    )
  })

  it('returns jobId and scheduleTime for scheduled post', async () => {
    const mockResponse = {
      message: 'Post scheduled successfully!',
      jobId: 'test-job-456',
      scheduleTime: '2026-02-20T10:00:00Z'
    }

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    })

    const result = await scheduleInstagramPost({
      socialId: 'instagram-account-456',
      images: ['https://example.com/image.jpg'],
      message: 'Another test post',
      scheduleTime: '2026-02-20T10:00:00Z'
    })

    expect(result).toEqual(mockResponse)
    expect(result.jobId).toBe('test-job-456')
    expect(result.scheduleTime).toBe('2026-02-20T10:00:00Z')
  })

  it('throws error when API returns 400 with error message', async () => {
    const errorResponse = {
      message: 'Schedule time must be at least 15 minutes in the future'
    }

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => errorResponse
    })

    await expect(
      scheduleInstagramPost({
        socialId: 'instagram-account-789',
        images: ['https://example.com/image.jpg'],
        message: 'Test post',
        scheduleTime: '2026-02-09T11:00:00Z'
      })
    ).rejects.toThrow('Schedule time must be at least 15 minutes in the future')
  })

  it('throws error when API returns 500', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({})
    })

    await expect(
      scheduleInstagramPost({
        socialId: 'instagram-account-999',
        images: ['https://example.com/image.jpg'],
        message: 'Test post',
        scheduleTime: '2026-02-25T15:00:00Z'
      })
    ).rejects.toThrow('Failed to schedule Instagram post: 500')
  })

  it('throws error when API response JSON parsing fails', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Invalid JSON')
      }
    })

    await expect(
      scheduleInstagramPost({
        socialId: 'instagram-account-error',
        images: ['https://example.com/image.jpg'],
        message: 'Test post',
        scheduleTime: '2026-03-01T12:00:00Z'
      })
    ).rejects.toThrow('Failed to schedule Instagram post: 502')
  })

  it('uses correct root domain in URL', async () => {
    const { getRootDomain } = await import('@/utils/getRootDomain')
    ;(getRootDomain as any).mockReturnValue('test.godaddy.com')

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobId: 'test-job',
        scheduleTime: '2026-02-15T14:30:00Z'
      })
    })

    // Re-import to get fresh module with updated mock
    vi.resetModules()
    const { scheduleInstagramPost: freshSchedule } = await import('./marketing-api')

    await freshSchedule({
      socialId: 'test-account',
      images: ['https://example.com/image.jpg'],
      message: 'Test',
      scheduleTime: '2026-02-15T14:30:00Z'
    })

    const fetchCalls = (global.fetch as any).mock.calls
    const lastCall = fetchCalls[fetchCalls.length - 1]
    expect(lastCall[0]).toContain('marketing.api.')
  })

  it('transforms image URLs to image objects', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobId: 'test-job',
        scheduleTime: '2026-02-15T14:30:00Z'
      })
    })

    await scheduleInstagramPost({
      socialId: 'test-account',
      images: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
      message: 'Multi-image post',
      scheduleTime: '2026-02-15T14:30:00Z'
    })

    const fetchCall = (global.fetch as any).mock.calls[0]
    const requestBody = JSON.parse(fetchCall[1].body)

    expect(requestBody.payload.images).toEqual([
      { src: 'https://example.com/photo1.jpg' },
      { src: 'https://example.com/photo2.jpg' }
    ])
  })

  it('includes credentials for SSO authentication', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobId: 'test-job',
        scheduleTime: '2026-02-15T14:30:00Z'
      })
    })

    await scheduleInstagramPost({
      socialId: 'test-account',
      images: ['https://example.com/image.jpg'],
      message: 'Test',
      scheduleTime: '2026-02-15T14:30:00Z'
    })

    const fetchCall = (global.fetch as any).mock.calls[0]
    expect(fetchCall[1].credentials).toBe('include')
  })
})
