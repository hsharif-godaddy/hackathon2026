/**
 * publishAction Tests
 *
 * Tests the publish action executor that triggers app publishing through the browser.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishErrorCode } from '@airo/shared/publish'

import { SiteStatus } from '@/lib/control-plane/types'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { publishAction } from './publishAction'
import { createMockMessageContext } from '../handlers/__tests__/testUtils'

// Mock dependencies
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
  authPreflight: vi.fn().mockResolvedValue(null),
  AuthDismissedError: class AuthDismissedError extends Error {
    constructor() { super('Authentication dismissed'); this.name = 'AuthDismissedError'; }
  },
}))

vi.mock('@/services/AppService', () => ({
  appService: {
    getGitHistory: vi.fn(),
  },
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: vi.fn(),
    subscribe: vi.fn(),
  },
}))

const mockOpenUpgradeModal = vi.fn()
vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: {
    getState: () => ({ openUpgradeModal: mockOpenUpgradeModal }),
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

vi.mock('@/lib/paywall/core', () => ({
  checkPaywallEligibility: vi.fn(),
  PaywallAction: {
    Publish: 'publish',
    Download: 'download',
  },
}))

vi.mock('@/lib/paywall/client-provider', () => ({
  ClientPaywallProvider: vi.fn().mockImplementation(function () { return {}; }),
}))

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn(),
}))

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn(),
  },
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/utils/instrumentation', () => ({
  logAiroHQEvent: vi.fn(),
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(),
}))

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { appFetch, authPreflight } from '@/lib/gasket-config'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { DeploymentStatus } from '@/lib/mgmt-airo/types'
import { checkPaywallEligibility } from '@/lib/paywall/core'
import { PublishComplianceBlockReason } from '@/lib/subscription'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionStatus, SubscriptionSuspendReason } from '@/types/credits'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

describe('publishAction', () => {
  let mockStoreActions: any
  let mockQueryClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authPreflight).mockResolvedValue(null)
    vi.mocked(shipAnalyticsLog).mockImplementation(() => {})

    // Default store actions
    mockStoreActions = {
      clearPublishStatus: vi.fn(),
      setIsPublishing: vi.fn(),
      setLastPublishedCommitHash: vi.fn(),
      setPublishError: vi.fn(),
      setPublishSuccess: vi.fn(),
      setBuildErrorDetails: vi.fn(),
      setDeploymentInProgressId: vi.fn(),
      setShowPaywallModal: vi.fn(),
      setShowFirstPublishCongrats: vi.fn(),
      setFirstPublishDeployPending: vi.fn(),
      getPublishState: vi.fn(function () { return { firstPublishDeployPending: false }; }),
    }

    vi.mocked(useDevelopPageStore.getState).mockReturnValue(mockStoreActions)

    // Default query client
    mockQueryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      fetchQuery: vi.fn().mockResolvedValue({
        id: 'app-123',
        name: 'Test Site',
        status: SiteStatus.Running,
        variants: ['publish'],
      }),
      getQueryData: vi.fn(function (key: unknown[]) {
        if (key[0] === 'featureFlag' && key[1] === 'appbuilder-suspended-compliance-banner') {
          return false
        }
        if (key[0] === 'subscriptions') {
          return { active: null, subscriptions: [] }
        }
        return undefined
      }),
    }

    vi.mocked(getQueryClient).mockReturnValue(mockQueryClient)

    // Default paywall eligibility - allow access
    vi.mocked(checkPaywallEligibility).mockResolvedValue({
      hasAccess: true,
      details: {
        hasSubscription: true,
        hasEntitlements: true,
        hasMatchingProject: false,
      },
    })

    // Default JWT regeneration
    vi.mocked(regenerateToken).mockResolvedValue({
      token: 'mock-jwt-token',
      expires: new Date(Date.now() + 43200000).toISOString(),
      siteId: 'test-site',
      type: 'jwt',
    })

    // Default dynamic API config
    vi.mocked(dynamicApiConfigService.getConfigForSite).mockResolvedValue({
      baseUrl: 'http://localhost:3000',
      wsUrl: 'ws://localhost:4000',
      agentUrl: 'http://localhost:4000',
      isStatic: false,
    })

    // Mock global fetch for agent service calls
    global.fetch = vi.fn()

    const defaultFetchedSite = {
      id: 'app-123',
      name: 'Test Site',
      status: SiteStatus.Running,
      variants: ['publish'],
    }

    vi.mocked(appFetch).mockImplementation(async function (url: string) {
      if (url.startsWith('/api/sites/app-123')) {
        return {
          ok: true,
          json: async () => defaultFetchedSite,
        } as Response
      }
      if (url.includes('/secrets')) {
        return {
          ok: true,
          json: async () => ({}),
        } as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response
    })

    // Default has been published - false for first-time publishing
    vi.mocked(hasBeenPublished).mockReturnValue(false)

    // Default analytics logging - mock to return a function
    vi.mocked(logAiroHQEvent).mockReturnValue(() => {})
    vi.mocked(logImpressionEvent).mockReturnValue(() => {})

    // Default: simulate successful deployment completion via store subscription.
    // useDeploymentsQuery already polls mgmt-airo; publishAction subscribes to the
    // store and resolves when deploymentInProgressId is cleared.
    vi.mocked(useDevelopPageStore.subscribe).mockImplementation(function (callback: any) {
      Promise.resolve().then(() => {
        callback({
          publishStates: {
            'app-123': {
              deploymentInProgressId: null,
              publishError: false,
            },
          },
        });
      });
      return vi.fn();
    })
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
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('paywall eligibility', () => {
    it('should check paywall eligibility before publishing', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(checkPaywallEligibility).toHaveBeenCalledWith(expect.any(Object), 'app-123', 'publish')
    })

    it('should allow publish when user has access', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(checkPaywallEligibility).mockResolvedValue({
        hasAccess: true,
        details: {
          hasSubscription: true,
          hasEntitlements: true,
          hasMatchingProject: false,
        },
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await expect(publishAction(params, context)).resolves.toBeDefined()
      expect(mockStoreActions.setShowPaywallModal).not.toHaveBeenCalled()
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
    })

    it('should block publish and show modal when user lacks access', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(checkPaywallEligibility).mockResolvedValue({
        hasAccess: false,
        reason: 'Airo Plus subscription required',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      })

      await expect(publishAction(params, context)).rejects.toThrow('Airo Plus subscription required')

      // Verify paywall state was tracked (prevents error alert)
      expect(mockStoreActions.setShowPaywallModal).toHaveBeenCalledWith('app-123', true)
      // Verify upgrade modal was actually shown in UI
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('publish', PAYWALL_ITC.PUBLISH)

      // Verify publish API was NOT called
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/publish'),
        expect.anything()
      )
    })

    it('should show modal and throw error when no subscription found', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(checkPaywallEligibility).mockResolvedValue({
        hasAccess: false,
        reason: 'No active subscription found',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      })

      await expect(publishAction(params, context)).rejects.toThrow('No active subscription found')
      expect(mockStoreActions.setShowPaywallModal).toHaveBeenCalledWith('app-123', true)
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('publish', PAYWALL_ITC.PUBLISH)
    })

    it('should continue gracefully if modal trigger fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockStoreActions.setShowPaywallModal.mockImplementation(function () {
        throw new Error('Store error')
      })

      vi.mocked(checkPaywallEligibility).mockResolvedValue({
        hasAccess: false,
        reason: 'Airo Plus subscription required',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      })

      // Should still throw the paywall error, not the store error
      await expect(publishAction(params, context)).rejects.toThrow('Airo Plus subscription required')
    })
  })

  describe('site suspension', () => {
    it('should block publish when site is suspended', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(mockQueryClient.fetchQuery).mockResolvedValue({
        id: 'app-123',
        status: SiteStatus.Suspended,
        variants: ['preview'],
      })

      await expect(publishAction(params, context)).rejects.toThrow(
        'Publish blocked: compliance suspension'
      )

      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/publish'),
        expect.anything()
      )
    })

    it('should block publish when subscription is non-compliant and compliance flag is on', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(mockQueryClient.getQueryData).mockImplementation(function (key: unknown[]) {
        if (key[0] === 'featureFlag' && key[1] === 'appbuilder-suspended-compliance-banner') {
          return true
        }
        if (key[0] === 'subscriptions') {
          return {
            active: {
              status: SubscriptionStatus.Suspended,
              reason: SubscriptionSuspendReason.Legal,
            },
            subscriptions: [],
          }
        }
        return undefined
      })

      await expect(publishAction(params, context)).rejects.toThrow(
        'Publish blocked: compliance suspension'
      )

      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/publish'),
        expect.anything()
      )
    })
  })

  describe('state management - initial', () => {
    it('should clear publish status before starting', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.clearPublishStatus).toHaveBeenCalledWith('app-123')
    })

    it('should set isPublishing to true before API call', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', true)
    })

    it('should continue if initial state update fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockStoreActions.clearPublishStatus.mockImplementation(function () {
        throw new Error('Store error')
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      // Should not throw - continues despite store error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('commit hash resolution', () => {
    it('should store commit hash from response in store', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          commitHash: 'response-hash',
          archive: { path: '/path/to/archive' }
        }),
      } as Response)

      await publishAction(params, context)

      // Verify commit hash from response is stored
      expect(mockStoreActions.setLastPublishedCommitHash).toHaveBeenCalledWith(
        'app-123',
        'response-hash'
      )
    })
  })

  describe('secrets sync', () => {
    it('should attempt to sync secrets before publishing', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock appFetch for app details (fallback) and secrets sync
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (url.startsWith('/api/sites/app-123')) {
          return {
            ok: true,
            json: async () => ({
              id: 'app-123',
              name: 'Test Site',
              status: SiteStatus.Running,
              variants: ['publish'],
            }),
          } as Response
        }
        if (url.includes('secrets')) {
          return {
            ok: true,
            json: async () => ({ success: true }),
          } as Response
        }
        throw new Error('Unexpected appFetch call')
      })

      // Mock global.fetch for publish call
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(appFetch).toHaveBeenCalledWith(
        '/api/secrets/app-123/sync',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ source: 'preview', destination: 'publish' }),
        }),
      )
    })

    it('should continue if secrets sync fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock appFetch for app details and secrets sync
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (url.startsWith('/api/sites/app-123')) {
          return {
            ok: true,
            json: async () => ({
              id: 'app-123',
              name: 'Test Site',
              status: SiteStatus.Running,
              variants: ['publish'],
            }),
          } as Response
        }
        if (url.includes('secrets')) {
          throw new Error('Sync failed')
        }
        throw new Error('Unexpected appFetch call')
      })

      // Mock global.fetch for publish call (should still succeed)
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      // Should not throw - continues despite sync error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should continue if secrets sync returns non-ok status', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock appFetch for app details and secrets sync
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (url.startsWith('/api/sites/app-123')) {
          return {
            ok: true,
            json: async () => ({
              id: 'app-123',
              name: 'Test Site',
              status: SiteStatus.Running,
              variants: ['publish'],
            }),
          } as Response
        }
        if (url.includes('secrets')) {
          return {
            ok: false,
            status: 500,
          } as Response
        }
        throw new Error('Unexpected appFetch call')
      })

      // Mock global.fetch for publish call (should still succeed)
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await expect(publishAction(params, context)).resolves.toBeDefined()
    })
  })

  describe('publish API call', () => {
    it('should call publish API with correct parameters', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'fetched-hash',
        commits: [],
        hasMore: false,
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      // Verify JWT regeneration
      expect(regenerateToken).toHaveBeenCalledWith({ siteId: 'app-123', force: true })

      // Verify dynamic API config fetch
      expect(dynamicApiConfigService.getConfigForSite).toHaveBeenCalledWith('app-123')

      // Verify publish API call to agent service
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/app-123/publish',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer mock-jwt-token',
          },
        })
      )
    })

    it('should return deployment data on success', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'abc123',
        commits: [],
        hasMore: false,
      })

      const mockResult = {
        commitHash: 'abc123',
        archive: { path: '/path/to/archive' },
        deployment: {
          deploymentId: 'deploy-456',
          status: 'in_progress',
          message: 'Deploying...',
        },
      }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await publishAction(params, context)

      expect(useDevelopPageStore.subscribe).toHaveBeenCalled()
      expect(result).toEqual({
        commitHash: 'abc123',
        archivePath: '/path/to/archive',
        deploymentId: 'deploy-456',
        deploymentStatus: DeploymentStatus.DEPLOYED,
        deploymentMessage: 'Deploying...',
      })
    })

    it('should retry once with fresh token on 401 TOKEN_STALE', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // First call returns TOKEN_STALE, retry succeeds
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ code: PublishErrorCode.TokenStale, error: 'Token too old' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ commitHash: 'abc123' }),
        } as Response)

      await publishAction(params, context)

      // Should have called regenerateToken twice: once before initial call, once for retry
      expect(regenerateToken).toHaveBeenCalledTimes(2)
      expect(regenerateToken).toHaveBeenLastCalledWith({ siteId: 'app-123', force: true })
      // Two fetch calls to the publish endpoint
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should NOT retry on 401 without TOKEN_STALE code', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized', code: 'SOME_OTHER_CODE' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Unauthorized')

      // Should NOT have retried — only the initial regenerateToken call
      expect(regenerateToken).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should use retry response body for error when retry also fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // First call: TOKEN_STALE, second call: different error
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ code: PublishErrorCode.TokenStale, error: 'Token too old' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server exploded' }),
        } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Server exploded')
    })

    it('should handle API error response', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Internal server error')
    })

    it('should handle build errors with details', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValue({
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

    it('should handle supervisor errors with logs (500 status)', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      const mockLogs = [
        { message: 'Starting application', source: 'stdout', timestamp: '2026-01-27T22:17:47Z' },
        { message: 'Error: Missing parameter name', source: 'stderr', timestamp: '2026-01-27T22:21:49Z' },
      ]

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Publish supervisor failed',
          details: 'Health check failed after restart',
          logs: mockLogs,
          exitCode: 1,
          healthStatus: 'unhealthy',
        }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Publish supervisor failed')

      expect(mockStoreActions.setBuildErrorDetails).toHaveBeenCalledWith('app-123', {
        error: 'Publish supervisor failed',
        details: 'Health check failed after restart\n\nStarting application\nError: Missing parameter name',
        exitCode: 1,
      })
    })

    it('should handle errors with only logs (no details field)', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      const mockLogs = [
        { message: 'Starting application' },
        { message: 'Fatal error occurred' },
      ]

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Runtime error',
          logs: mockLogs,
          exitCode: 1,
        }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Runtime error')

      // Should extract logs into details field
      expect(mockStoreActions.setBuildErrorDetails).toHaveBeenCalledWith('app-123', {
        error: 'Runtime error',
        details: 'Starting application\nFatal error occurred',
        exitCode: 1,
      })
    })
  })

  describe('error state management', () => {
    it('should set error state and clear publishing state on API error', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock store state with no paywall modal showing
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: false,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      vi.mocked(global.fetch).mockResolvedValue({
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

      // Mock store state with no paywall modal showing
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: false,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))

      await expect(publishAction(params, context)).rejects.toThrow('Network error')

      expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should NOT set error state when paywall modal is showing on API error', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock store state to show paywall modal is active
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: true,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow()

      // Should NOT set publish error when paywall modal is showing
      expect(mockStoreActions.setPublishError).not.toHaveBeenCalled()
      // But should still clear publishing state
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should NOT set error state when paywall modal is showing on exception', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock store state to show paywall modal is active
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: true,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))

      await expect(publishAction(params, context)).rejects.toThrow('Network error')

      // Should NOT set publish error when paywall modal is showing
      expect(mockStoreActions.setPublishError).not.toHaveBeenCalled()
      // But should still clear publishing state
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should NOT set error state when paywall blocks publish', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock paywall blocking access
      vi.mocked(checkPaywallEligibility).mockResolvedValue({
        hasAccess: false,
        reason: 'Airo Plus subscription required',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      })

      // Mock store state so that showPaywallModal is initially false, and becomes true after setShowPaywallModal is called
      let showPaywallModal = false
      const originalSetShowPaywallModal = mockStoreActions.setShowPaywallModal
      const statefulSetShowPaywallModal = vi.fn(function (appId: string, value: boolean) {
        showPaywallModal = value
        return originalSetShowPaywallModal(appId, value)
      })

      vi.mocked(useDevelopPageStore.getState).mockImplementation(function () { return {
        ...mockStoreActions,
        setShowPaywallModal: statefulSetShowPaywallModal,
        publishStates: {
          'app-123': {
            showPaywallModal,
            isPublishing: false,
            publishError: false,
          },
        },
      }; })

      await expect(publishAction(params, context)).rejects.toThrow('Airo Plus subscription required')

      // Paywall state should be tracked (prevents error alert)
      expect(mockStoreActions.setShowPaywallModal).toHaveBeenCalledWith('app-123', true)
      // Upgrade modal should be shown in UI
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('publish', PAYWALL_ITC.PUBLISH)
      // Should NOT set publish error when paywall modal is showing
      expect(mockStoreActions.setPublishError).not.toHaveBeenCalled()
      // But should still clear publishing state
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should set error state when paywall modal is NOT showing', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock store state to show paywall modal is NOT active
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: false,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (url.startsWith('/api/sites/app-123')) {
          return {
            ok: true,
            json: async () => ({
              id: 'app-123',
              name: 'Test Site',
              status: SiteStatus.Running,
              variants: ['publish'],
            }),
          } as Response
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        } as Response
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'API error' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow()

      // Should set publish error when paywall modal is NOT showing
      expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should set error state when publishStates is empty', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock store state with no publishStates for this app
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {},
      })

      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (url.startsWith('/api/sites/app-123')) {
          return {
            ok: true,
            json: async () => ({
              id: 'app-123',
              name: 'Test Site',
              status: SiteStatus.Running,
              variants: ['publish'],
            }),
          } as Response
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        } as Response
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'API error' }),
      } as Response)

      await expect(publishAction(params, context)).rejects.toThrow()

      // Should set publish error when no state exists (defaults to no paywall modal)
      expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should continue if error state update fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      // Mock store state with no paywall modal showing
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: false,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      mockStoreActions.setPublishError.mockImplementation(function () {
        throw new Error('Store error')
      })

      vi.mocked(global.fetch).mockResolvedValue({
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

      vi.mocked(global.fetch).mockResolvedValue({
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

      vi.mocked(global.fetch).mockResolvedValue({
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

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      // Should not throw - continues without query invalidation
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should show success immediately if no deploymentId', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ commitHash: 'abc123' }),
      } as Response)

      await publishAction(params, context)

      expect(mockStoreActions.setDeploymentInProgressId).not.toHaveBeenCalled()
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['app-details', 'app-123'],
      })
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
      expect(mockStoreActions.setPublishSuccess).toHaveBeenCalledWith('app-123', true)
    })

    it('should continue if deployment ID store update fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      mockStoreActions.setDeploymentInProgressId.mockImplementation(function () {
        throw new Error('Store error')
      })

      vi.mocked(global.fetch).mockResolvedValue({
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

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456' },
        }),
      } as Response)

      // Should not throw - continues despite query error
      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should reject when deployment wait reports failed', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123', commitHash: 'abc123' }

      vi.mocked(useDevelopPageStore.subscribe).mockImplementation(function (callback: any) {
        Promise.resolve().then(() => {
          callback({
            publishStates: {
              'app-123': {
                deploymentInProgressId: null,
                publishError: true,
              },
            },
          });
        });
        return vi.fn();
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-456', status: 'deploying' },
        }),
      } as Response)

      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        ...mockStoreActions,
        publishStates: {
          'app-123': {
            showPaywallModal: false,
            isPublishing: false,
            publishError: false,
          },
        },
      })

      await expect(publishAction(params, context)).rejects.toThrow(
        'Deployment failed. Check the Publish panel for details.'
      )

      expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      expect(mockStoreActions.setIsPublishing).toHaveBeenCalledWith('app-123', false)
    })

    it('should reject when deployment wait times out', async () => {
      vi.useFakeTimers()

      try {
        const context = createMockMessageContext()
        const params = { appId: 'app-123', commitHash: 'abc123' }

        // Subscribe never fires - simulates deployment that never completes
        vi.mocked(useDevelopPageStore.subscribe).mockReturnValue(vi.fn())

        vi.mocked(global.fetch).mockResolvedValue({
          ok: true,
          json: async () => ({
            commitHash: 'abc123',
            deployment: { deploymentId: 'deploy-456' },
          }),
        } as Response)

        vi.mocked(useDevelopPageStore.getState).mockReturnValue({
          ...mockStoreActions,
          publishStates: {
            'app-123': {
              showPaywallModal: false,
              isPublishing: false,
              publishError: false,
            },
          },
        })

        const promise = publishAction(params, context)
        // Attach rejection handler early to prevent Node.js unhandled-rejection
        // warning during timer advancement (the assertion below still observes
        // the original rejection).
        promise.catch(() => {})

        // Flush microtasks so publishAction reaches waitForPublishResult
        await vi.advanceTimersByTimeAsync(0)
        // Advance past the 5-minute timeout
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)

        await expect(promise).rejects.toThrow(
          'Deployment did not reach a finished state within the time limit. Check the Publish panel or try again.'
        )

        expect(mockStoreActions.setPublishError).toHaveBeenCalledWith('app-123', true)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('analytics tracking', () => {
    it('should log publish.attempted when gates pass', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(mockQueryClient.fetchQuery).mockResolvedValue({
        id: 'app-123',
        name: 'Test Site',
        status: SiteStatus.Running,
        variants: ['publish'],
        gitHash: 'gate-pass-hash',
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-123' },
        }),
      } as Response)

      await publishAction(params, context)

      expect(shipAnalyticsLog).toHaveBeenCalledWith('publish.attempted', {
        appId: 'app-123',
        commitHash: 'gate-pass-hash',
        trigger: 'agent',
      })
      expect(logImpressionEvent).toHaveBeenCalledWith('develop.publish.attempt', {
        appId: 'app-123',
        trigger: 'agent',
      })
    })

    it('should log publish.attempted with blockedReason when paywall denies access', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(checkPaywallEligibility).mockResolvedValue({
        hasAccess: false,
        reason: 'Airo Plus subscription required',
        details: {
          hasSubscription: false,
          hasEntitlements: false,
          hasMatchingProject: false,
        },
      })

      await expect(publishAction(params, context)).rejects.toThrow('Airo Plus subscription required')

      expect(shipAnalyticsLog).toHaveBeenCalledWith('publish.attempted', {
        appId: 'app-123',
        blockedReason: 'paywall_denied',
        trigger: 'agent',
      })
      expect(logImpressionEvent).toHaveBeenCalledWith('develop.publish.attempt', {
        appId: 'app-123',
        blockedReason: 'paywall_denied',
        trigger: 'agent',
      })
    })

    it('should log publish.attempted with blockedReason when compliance blocks publish', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(mockQueryClient.fetchQuery).mockResolvedValue({
        id: 'app-123',
        status: SiteStatus.Suspended,
        variants: ['preview'],
      })

      await expect(publishAction(params, context)).rejects.toThrow(
        'Publish blocked: compliance suspension'
      )

      expect(shipAnalyticsLog).toHaveBeenCalledWith('publish.attempted', {
        appId: 'app-123',
        blockedReason: PublishComplianceBlockReason.SiteSuspended,
        trigger: 'agent',
      })
      expect(logImpressionEvent).toHaveBeenCalledWith('develop.publish.attempt', {
        appId: 'app-123',
        blockedReason: PublishComplianceBlockReason.SiteSuspended,
        trigger: 'agent',
      })
    })

    it('should log publish.attempted with auth_required when auth preflight fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(authPreflight).mockResolvedValue({ ok: false } as Response)

      await expect(publishAction(params, context)).rejects.toThrow('Authentication required')

      expect(shipAnalyticsLog).toHaveBeenCalledWith('publish.attempted', {
        appId: 'app-123',
        blockedReason: 'auth_required',
        trigger: 'agent',
      })
      expect(logImpressionEvent).toHaveBeenCalledWith('develop.publish.attempt', {
        appId: 'app-123',
        blockedReason: 'auth_required',
        trigger: 'agent',
      })
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/publish'),
        expect.anything()
      )
    })

    it('should continue publish if publish.attempted analytics fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      vi.mocked(shipAnalyticsLog).mockImplementation(function throwOnGatePassAttempt(event: string) {
        if (event === 'publish.attempted') {
          throw new Error('Attempt analytics error')
        }
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-123' },
        }),
      } as Response)

      await expect(publishAction(params, context)).resolves.toBeDefined()
    })

    it('should log analytics event for first-time publish', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      // Mock first-time publishing
      vi.mocked(hasBeenPublished).mockReturnValue(false)

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'abc123',
        commits: [],
        hasMore: false,
      })

      // Mock secrets sync
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      // Mock agent service publish call
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-123' },
        }),
      } as Response)

      await publishAction(params, context)

      // Verify analytics logging
      expect(logAiroHQEvent).toHaveBeenCalledWith({
        category: 'click',
        recommendation_task: 'builder_project_first_published',
        recommendation_type: 'publish',
        recommendation_id: 'app-123',
      })
    })

    it('should log analytics event for subsequent publish', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      // Mock subsequent publishing (site has been published before)
      vi.mocked(hasBeenPublished).mockReturnValue(true)

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'abc123',
        commits: [],
        hasMore: false,
      })

      // Mock secrets sync
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      // Mock agent service publish call
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-123' },
        }),
      } as Response)

      await publishAction(params, context)

      // Verify analytics logging
      expect(logAiroHQEvent).toHaveBeenCalledWith({
        category: 'click',
        recommendation_task: 'builder_project_published',
        recommendation_type: 'publish',
        recommendation_id: 'app-123',
      })
    })

    it('should continue publish if analytics logging fails', async () => {
      const context = createMockMessageContext()
      const params = { appId: 'app-123' }

      // Mock analytics failure
      vi.mocked(logAiroHQEvent).mockImplementation(function () {
        throw new Error('Analytics error')
      })

      vi.mocked(appService.getGitHistory).mockResolvedValue({
        currentCommit: 'abc123',
        commits: [],
        hasMore: false,
      })

      // Mock secrets sync
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      // Mock agent service publish call
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          commitHash: 'abc123',
          deployment: { deploymentId: 'deploy-123' },
        }),
      } as Response)

      // Should not throw - continues despite analytics error
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
        hasMore: false,
      })

      // Mock appFetch for app details and secrets sync
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (url.startsWith('/api/sites/app-123')) {
          return {
            ok: true,
            json: async () => ({
              id: 'app-123',
              name: 'Test Site',
              status: SiteStatus.Running,
              variants: ['publish'],
            }),
          } as Response
        }
        if (url.includes('secrets')) {
          return { ok: true, json: async () => ({}) } as Response
        }
        throw new Error('Unexpected appFetch call')
      })

      // Mock global.fetch for publish call to agent service
      vi.mocked(global.fetch).mockResolvedValue({
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
      } as Response)

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

      // Verify JWT regeneration
      expect(regenerateToken).toHaveBeenCalledWith({ siteId: 'app-123', force: true })

      // Verify dynamic API config fetch
      expect(dynamicApiConfigService.getConfigForSite).toHaveBeenCalledWith('app-123')

      // Verify publish API call to agent service
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/apps/app-123/publish',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer mock-jwt-token',
          },
        })
      )

      // Verify result
      expect(useDevelopPageStore.subscribe).toHaveBeenCalled()
      expect(result).toEqual({
        commitHash: 'fetched-hash',
        archivePath: '/archive/path',
        deploymentId: 'deploy-789',
        deploymentStatus: DeploymentStatus.DEPLOYED,
        deploymentMessage: 'Deploying to production',
      })
    })
  })
})
