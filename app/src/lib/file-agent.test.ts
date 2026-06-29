import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getFileMetadataAgent, getFileServeAgent, getFileUploadAgent } from '@/lib/file-agent'

const mockGetAgentToken = vi.fn()
const mockBuildDynamicAgentUrl = vi.fn()

const { AgentTokenAcquisitionError } = vi.hoisted(function hoistErrors() {
  class AgentTokenAcquisitionError extends Error {
    readonly reason: 'auth_dismissed' | 'auth_failed';

    constructor(reason: 'auth_dismissed' | 'auth_failed', message: string) {
      super(message);
      this.name = 'AgentTokenAcquisitionError';
      this.reason = reason;
    }
  }
  return { AgentTokenAcquisitionError };
});

vi.mock('@/lib/agent-fetch', () => ({
  getAgentToken: (...args: unknown[]) => mockGetAgentToken(...args),
  AgentTokenAcquisitionError,
}));

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: (...args: unknown[]) => mockBuildDynamicAgentUrl(...args),
}))

describe('file-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgentToken.mockResolvedValue('token-for-app')
    mockBuildDynamicAgentUrl.mockResolvedValue('http://agent:4000/files/upload')
  })

  describe('#getFileUploadAgent', () => {
    it('should return token and upload URL', async function returnsBoth() {
      const result = await getFileUploadAgent('app-basic')
      expect(result.token).toBe('token-for-app')
      expect(result.uploadUrl).toBe('http://agent:4000/files/upload')
    })

    it('should fetch token and resolve URL in parallel', async function parallel() {
      const order: string[] = []
      mockGetAgentToken.mockImplementation(async function () {
        order.push('fetch')
        return 'token-for-app'
      })
      mockBuildDynamicAgentUrl.mockImplementation(async function () {
        order.push('url')
        return 'http://agent:4000/files/upload'
      })

      await getFileUploadAgent('app-parallel')

      expect(order).toContain('fetch')
      expect(order).toContain('url')
      expect(mockGetAgentToken).toHaveBeenCalledOnce()
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledOnce()
    })

    it('should call getAgentToken for each appId', async function perApp() {
      await getFileUploadAgent('app-cache')
      await getFileUploadAgent('app-cache')

      expect(mockGetAgentToken).toHaveBeenCalledTimes(2)
      expect(mockGetAgentToken).toHaveBeenCalledWith('app-cache')
    })

    it('should propagate token acquisition failures', async function throwsOnFail() {
      mockGetAgentToken.mockRejectedValueOnce(
        new AgentTokenAcquisitionError('auth_failed', 'Failed to get agent token: 401')
      )
      await expect(getFileUploadAgent('app-fail-upload')).rejects.toThrow(
        'Failed to get agent token: 401'
      )
    })

    it('should call buildDynamicAgentUrl with files/upload path', async function correctPath() {
      await getFileUploadAgent('app-path')
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith('files/upload', 'app-path')
    })
  })

  describe('#getFileServeAgent', () => {
    it('should return token and serve URL', async function returnsBoth() {
      mockBuildDynamicAgentUrl.mockResolvedValue('http://agent:4000/files/uploads/app-serve/file.jpg')
      const result = await getFileServeAgent('app-serve', 'file.jpg')
      expect(result.token).toBe('token-for-app')
      expect(result.serveUrl).toBe('http://agent:4000/files/uploads/app-serve/file.jpg')
    })

    it('should call buildDynamicAgentUrl with correct file path', async function correctPath() {
      await getFileServeAgent('app-serve-path', 'photo.jpg')
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'files/uploads/app-serve-path/photo.jpg',
        'app-serve-path'
      )
    })
  })

  describe('#getFileMetadataAgent', () => {
    it('should return token and metadata URL', async function returnsBoth() {
      mockBuildDynamicAgentUrl.mockResolvedValue('http://agent:4000/files/app-meta/upload-123')
      const result = await getFileMetadataAgent('app-meta', 'upload-123')
      expect(result.token).toBe('token-for-app')
      expect(result.metadataUrl).toBe('http://agent:4000/files/app-meta/upload-123')
    })

    it('should call buildDynamicAgentUrl with correct path', async function correctPath() {
      await getFileMetadataAgent('app-meta-path', 'upload-abc')
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'files/app-meta-path/upload-abc',
        'app-meta-path'
      )
    })

    it('should propagate token acquisition failures', async function throwsOnFail() {
      mockGetAgentToken.mockRejectedValueOnce(new Error('Failed to get agent token: 403'))
      await expect(getFileMetadataAgent('app-fail-meta', 'upload-xyz')).rejects.toThrow(
        'Failed to get agent token: 403'
      )
    })
  })
})
