/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'http://localhost:4000/apps/test-app' }),
  },
}))

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

describe('useRecentUploads', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  it('returns empty uploads when appId is null', async () => {
    const { useRecentUploads } = await import('./useRecentUploads')
    const { result } = renderHook(() => useRecentUploads({ appId: null }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.uploads).toEqual([])
  })

  it('fetches and filters media files', async () => {
    const mockFiles = [
      { id: '1', filename: 'photo.jpg', originalName: 'photo.jpg', mimeType: 'image/jpeg', size: 1000, signedUrl: '/signed/photo.jpg' },
      { id: '2', filename: 'doc.pdf', originalName: 'doc.pdf', mimeType: 'application/pdf', size: 2000, signedUrl: '/signed/doc.pdf' },
      { id: '3', filename: 'clip.mp4', originalName: 'clip.mp4', mimeType: 'video/mp4', size: 5000, signedUrl: '/signed/clip.mp4' },
    ]

    const { dynamicApiConfigService } = await import('@/config/dynamic-api')
    ;(dynamicApiConfigService.getConfigForSite as ReturnType<typeof vi.fn>).mockResolvedValue({ agentUrl: 'http://localhost:4000/apps/test-app' })

    const { regenerateToken } = await import('@/lib/jwt-regeneration')
    ;(regenerateToken as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'test-token' })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: mockFiles }),
    })

    const { useRecentUploads } = await import('./useRecentUploads')
    const { result } = renderHook(() => useRecentUploads({ appId: 'test-app' }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // Should include image and video, exclude PDF
    expect(result.current.uploads).toHaveLength(2)
    expect(result.current.uploads[0].filename).toBe('photo.jpg')
    expect(result.current.uploads[1].filename).toBe('clip.mp4')
    // Should have full signed URL
    expect(result.current.uploads[0].fullSignedUrl).toBe('http://localhost:4000/signed/photo.jpg')
  })

  it('handles fetch errors gracefully', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false })

    const { useRecentUploads } = await import('./useRecentUploads')
    const { result } = renderHook(() => useRecentUploads({ appId: 'test-app' }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('Failed to load uploads')
    expect(result.current.uploads).toEqual([])
  })
})
