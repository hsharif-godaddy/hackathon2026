/**
 * publishAction Tests
 *
 * Tests the publish action executor that triggers app publishing through the browser.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishAction } from '../publishAction'
import { createMockMessageContext } from '../../handlers/__tests__/testUtils'

// Mock dependencies
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}))

vi.mock('@/services/AppService', () => ({
  appService: {
    getGitHistory: vi.fn(),
  },
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: vi.fn(),
  },
}))

vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { appFetch } from '@/lib/gasket-config'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { getQueryClient } from '@/components/providers/QueryClientProvider'

describe('publishAction', () => {
  let mockStoreActions: any
  let mockQueryClient: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Default store actions
    mockStoreActions = {
      clearPublishStatus: vi.fn(),
      setIsPublishing: vi.fn(),
      setLastPublishedCommitHash: vi.fn(),
      setPublishError: vi.fn(),
      setBuildErrorDetails: vi.fn(),
      setDeploymentInProgressId: vi.fn(),
    }

    vi.mocked(useDevelopPageStore.getState).mockReturnValue(mockStoreActions)

    // Default query client
    mockQueryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }

    vi.mocked(getQueryClient).mockReturnValue(mockQueryClient)
  })

  describe('parameter validation', () => {
    it('should throw error if appId is missing', async () => {
      const context = createMockMessageContext()
      const params = {} as any

      await expect(publishAction(params, context)).rejects.toThrow(
        'appId is required and must be a string'
      )
    })

    it('should throw error if appId is not a string', async () => {
      const context = createMockMessageContext()
      const params = { appId: 123 } as any

      await expect(publishAction(params, context)).rejects.toThrow(
        'appId is required and must be a string'
      )
    })

    it('should accept valid appId', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock successful flow
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('state management - initial', () => {
    it('should clear publish status before starting', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.clearPublishStatus).toHaveBeenCalledWith('app-123')
    })

    it('should set isPublishing to true before API call', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', true)
    })

    it('should continue if initial state update fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockStoreActions.clearPublishStatus.mockImplementation(() => {
        throw new Error('Store error')
      })

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      // Should not throw - continues despite store error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('commit hash resolution', () => {
    it('should use provided commitHash', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'provided-hash' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'provided-hash' }),
      } as Response)

      await publishAction(params, context)

      expect(appService.getGitHistory).not.toHaveBeenCalled()
    })

    it('should fetch current commit if not provided', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'fetched-hash',
        commits: [],
      })

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'fetched-hash' }),
      } as Response)

      await publishAction(params, context)

      expect(appService.getGitHistory).toHaveBeenCalledWith('app-123')
    })

    it('should use first commit from history if currentCommit is null', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: null,
        commits: [{ hash: 'first-commit' }],
      } as any)

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'first-commit' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setLastPublishedCommitHash).toHaveBeenCalledWith(
        'app-123',
        'first-commit'
      )
    })

    it('should throw error if no commits found', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: null,
        commits: [],
      } as any)

      await expect(publishAction(params, context)).rejects.toThrow(
        'No commit found in git history'
      )
    })

    it('should store commit hash in store', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setLastPublishedCommitHash).toHaveBeenCalledWith(
        'app-123',
        'abc123'
      )
    })
  })

  describe('secrets sync', () => {
    it('should attempt to sync secrets before publishing', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (url.includes('secrets')) {
          return {
            ok: true,
            json: async () => ({ success: true }),
          } as Response
        }
        return {
          ok: true,
          json: async () => ({ commitHash: 'abc123' }),
        } as Response
      })

      await publishAction(params, context)

      expect(appFetch).toHaveBeenCalledWith(
        '/api/secrets/app-123/sync',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ source: 'preview', destination: 'publish' }),
        })
      )
    })

    it('should continue if secrets sync fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (url.includes('secrets')) {
          throw new Error('Sync failed')
        }
        return {
          ok: true,
          json: async () => ({ commitHash: 'abc123' }),
        } as Response
      })

      // Should not throw - continues despite sync error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should continue if secrets sync returns non-ok status', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (url.includes('secrets')) {
          return {
            ok: false,
            status: 500,
          } as Response
        }
        return {
          ok: true,
          json: async () => ({ commitHash: 'abc123' }),
        } as Response
      })

      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('publish API call', () => {
    it('should call publish API with correct parameters', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(appFetch).toHaveBeenCalledWith(
        '/api/apps/app-123/publish',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitHash: 'abc123' }),
        })
      )
    })

    it('should return deployment data on success', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      const mockResult = {
        commitHash: 'abc123',
        archive: { path: '/path/to/archive' },
        deployment: {
          deploymentId: 'deploy-456',
          status: 'in_progress',
          message: 'Deploying...',
        },
      }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await publishAction(params, context)

      expect(result).toEqual({
        commitHash: 'abc123',
        archivePath: '/path/to/archive',
        deploymentId: 'deploy-456',
        deploymentStatus: 'in_progress',
        deploymentMessage: 'Deploying...',
      })
    })

    it('should handle API error response', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Internal server error')
    })

    it('should handle build errors with details', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Build failed',
          details: 'Compilation error',
          exitCode: 1,
        }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Build failed')

      expect(mockStoreActions.setBuildErrorDetails).toHaveBeenCalledWith('app-123', {
        error: 'Build failed',
        details: 'Compilation error',
        exitCode: 1,
      })
    })
  })

  describe('error state management', () => {
    it('should set error state and clear publishing state on API error', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow()

      expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should set error state on exception', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockRejectedValue(new Error('Network error'))

      await expect(publishAction(params, context)).rejects.toThrow('Network error')

      expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should continue if error state update fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockStoreActions.setPublishError.mockImplementation(() => {
        throw new Error('Store error')
      })

      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'API error' }),
      } as Response)

      // Should still throw the API error, not the store error
      await expect(publishAction(params, context)).rejects.toThrow('API error')
    })
  })

  describe('deployment tracking', () => {
    it('should set deployment ID in store when deployment is created', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setDeploymentInProgressId).toHaveBeenCalledWith(
        'app-123',
        'deploy-456'
      )
    })

    it('should invalidate queries when deployment is created', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      await publishAction(params, context)

      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['deployments', 'app-123'],
        refetchType: 'active',
      })
    })

    it('should skip query invalidation if no query client', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(getQueryClient).mockReturnValue(null)

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      // Should not throw - continues without query invalidation
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should skip deployment tracking if no deploymentId', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setDeploymentInProgressId).not.toHaveBeenCalled()
      expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalled()
    })

    it('should continue if deployment ID store update fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockStoreActions.setDeploymentInProgressId.mockImplementation(() => {
        throw new Error('Store error')
      })

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      // Should not throw - continues despite store error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should continue if query invalidation fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockQueryClient.invalidateQueries.mockRejectedValue(new Error('Query error'))

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      // Should not throw - continues despite query error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('complete flow', () => {
    it('should execute full publish flow successfully', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'fetched-hash',
        commits: [],
      })

      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (url.includes('secrets')) {
          return { ok: true, json: async () => ({}) } as Response
        }
        return {
          ok: true,
          json: async () => ({
            commitHash: 'fetched-hash',
            archive: { path: '/archive/path' },
            deployment: {
              deploymentId: 'deploy-789',
              status: 'in_progress',
              message: 'Deploying to production',
            },
          }),
        } as Response
      })

      const result = await publishAction(params, context)

      // Verify state updates
      expect(mockStoreActions.clearPublishStatus).toHaveBeenCalledWith('app-123')
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setLastPublishedCommitHash).toHaveBeenCalledWith(
        'app-123',
        'fetched-hash'
      )
      expect(mockStoreActions.setDeploymentInProgressId).toHaveBeenCalledWith(
        'app-123',
        'deploy-789'
      )

      // Verify result
      expect(result).toEqual({
        commitHash: 'fetched-hash',
        archivePath: '/archive/path',
        deploymentId: 'deploy-789',
        deploymentStatus: 'in_progress',
        deploymentMessage: 'Deploying to production',
      })
    })
  })
})
