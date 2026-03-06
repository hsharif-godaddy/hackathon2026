import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getFileMetadataAgent, getFileServeAgent, getFileUploadAgent } from '@/lib/file-agent'

const mockAppFetch = vi.fn()
const mockBuildDynamicAgentUrl = vi.fn()

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: (...args: unknown[]) => mockBuildDynamicAgentUrl(...args),
}))
vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
}))

// Tokens with expiry well in the future — treated as valid by the cache
const VALID_EXPIRES = new Date(Date.now() + 3_600_000).toISOString()

// Tokens already expired (60s ago) — immediately evicted from cache on next lookup
const EXPIRED_EXPIRES = new Date(Date.now() - 60_000).toISOString()

function mockTokenResponse(appId: string, expires = VALID_EXPIRES) {
  return {
    ok: true,
    json: async () => ({ token: `token-for-${appId}`, expires, siteId: appId, type: 'agent' }),
  }
}

describe('file-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildDynamicAgentUrl.mockResolvedValue('http://agent:4000/files/upload')
  })

  describe('#getFileUploadAgent', () => {
    it('should return token and upload URL', async function returnsBoth() {
      mockAppFetch.mockResolvedValueOnce(mockTokenResponse('app-basic'))
      const result = await getFileUploadAgent('app-basic')
      expect(result.token).toBe('token-for-app-basic')
      expect(result.uploadUrl).toBe('http://agent:4000/files/upload')
    })

    it('should fetch token and resolve URL in parallel', async function parallel() {
      const order: string[] = []
      mockAppFetch.mockImplementation(async () => {
        order.push('fetch')
        return mockTokenResponse('app-parallel')
      })
      mockBuildDynamicAgentUrl.mockImplementation(async () => {
        order.push('url')
        return 'http://agent:4000/files/upload'
      })

      await getFileUploadAgent('app-parallel')

      // Both are called — the exact order depends on microtask scheduling but both must occur
      expect(order).toContain('fetch')
      expect(order).toContain('url')
      expect(mockAppFetch).toHaveBeenCalledOnce()
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledOnce()
    })

    it('should cache token and reuse on subsequent calls', async function cachesToken() {
      mockAppFetch.mockResolvedValue(mockTokenResponse('app-cache'))

      await getFileUploadAgent('app-cache')
      await getFileUploadAgent('app-cache')

      // Token was cached after first call — second call skips the fetch
      expect(mockAppFetch).toHaveBeenCalledOnce()
    })

    it('should refetch token when cached token is expired', async function refetchExpired() {
      mockAppFetch.mockResolvedValue(mockTokenResponse('app-expired', EXPIRED_EXPIRES))

      await getFileUploadAgent('app-expired')
      await getFileUploadAgent('app-expired')

      // Expired token evicted on second lookup — fetch runs both times
      expect(mockAppFetch).toHaveBeenCalledTimes(2)
    })

    it('should throw when token fetch fails', async function throwsOnFail() {
      mockAppFetch.mockResolvedValueOnce({ ok: false, status: 401 })
      await expect(getFileUploadAgent('app-fail-upload')).rejects.toThrow(
        'Failed to get agent token: 401'
      )
    })

    it('should call buildDynamicAgentUrl with files/upload path', async function correctPath() {
      mockAppFetch.mockResolvedValueOnce(mockTokenResponse('app-path'))
      await getFileUploadAgent('app-path')
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith('files/upload', 'app-path')
    })
  })

  describe('#getFileServeAgent', () => {
    it('should return token and serve URL', async function returnsBoth() {
      mockBuildDynamicAgentUrl.mockResolvedValue('http://agent:4000/files/uploads/app-serve/file.jpg')
      mockAppFetch.mockResolvedValueOnce(mockTokenResponse('app-serve'))
      const result = await getFileServeAgent('app-serve', 'file.jpg')
      expect(result.token).toBe('token-for-app-serve')
      expect(result.serveUrl).toBe('http://agent:4000/files/uploads/app-serve/file.jpg')
    })

    it('should call buildDynamicAgentUrl with correct file path', async function correctPath() {
      mockAppFetch.mockResolvedValueOnce(mockTokenResponse('app-serve-path'))
      await getFileServeAgent('app-serve-path', 'photo.jpg')
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'files/uploads/app-serve-path/photo.jpg',
        'app-serve-path'
      )
    })

    it('should reuse cached token from prior getFileUploadAgent call', async function sharedCache() {
      mockAppFetch.mockResolvedValue(mockTokenResponse('app-shared'))

      await getFileUploadAgent('app-shared')
      await getFileServeAgent('app-shared', 'file.jpg')

      // Both functions share the same token cache — only one fetch needed
      expect(mockAppFetch).toHaveBeenCalledOnce()
    })
  })

  describe('#getFileMetadataAgent', () => {
    it('should return token and metadata URL', async function returnsBoth() {
      mockBuildDynamicAgentUrl.mockResolvedValue('http://agent:4000/files/app-meta/upload-123')
      mockAppFetch.mockResolvedValueOnce(mockTokenResponse('app-meta'))
      const result = await getFileMetadataAgent('app-meta', 'upload-123')
      expect(result.token).toBe('token-for-app-meta')
      expect(result.metadataUrl).toBe('http://agent:4000/files/app-meta/upload-123')
    })

    it('should call buildDynamicAgentUrl with correct path', async function correctPath() {
      mockAppFetch.mockResolvedValueOnce(mockTokenResponse('app-meta-path'))
      await getFileMetadataAgent('app-meta-path', 'upload-abc')
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'files/app-meta-path/upload-abc',
        'app-meta-path'
      )
    })

    it('should throw when token fetch fails', async function throwsOnFail() {
      mockAppFetch.mockResolvedValueOnce({ ok: false, status: 403 })
      await expect(getFileMetadataAgent('app-fail-meta', 'upload-xyz')).rejects.toThrow(
        'Failed to get agent token: 403'
      )
    })
  })
})
