import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSubscriptionCacheStore } from '@/stores/useSubscriptionCacheStore'
import { V2ControlPlaneAdapter } from '../v2-control-plane-adapter'

// Mock the mgmt-airo client
const mockClient = {
  checkCustomer: vi.fn().mockResolvedValue({ id: 'customer-123' }),
  getCustomerTree: vi.fn().mockResolvedValue({
    customerId: 'customer-123',
    subscriptions: [
      {
        subscriptionId: 'sub-1',
        status: 'active',
        systems: [
          {
            systemId: 'sys-sub-1-1',
            apps: [{ id: 'test-app-id' }]
          }
        ]
      }
    ]
  }),
  getSubscriptions: vi.fn().mockResolvedValue([
    { id: 'sub-1', status: 'active' },
    { id: 'sub-2', status: 'active' }
  ]),
  getSystems: vi.fn().mockImplementation(async (subId: string) => [
    { id: `sys-${subId}-1`, name: `System 1 for ${subId}` }
  ]),
  getAppsForSystem: vi.fn().mockImplementation(async (subId: string, sysId: string) => [
    { id: 'test-app-id', systemId: sysId, subscriptionId: subId }
  ]),
  getApp: vi.fn().mockImplementation(async (subId: string, sysId: string, appId: string) => ({
    id: appId,
    systemId: sysId,
    subscriptionId: subId,
    status: 'active',
    variables: { title: 'Test App', initialPrompt: 'Test prompt' },
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z'
  })),
  getAiroJobApps: vi.fn().mockRejectedValue({
    status: 404,
    message: 'Job not found'
  }),
  deleteApp: vi.fn().mockResolvedValue({ success: true })
}

// Mock the AiroMgmtClient
vi.mock('@/lib/mgmt-airo/client', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(() => mockClient)
}))

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

// Mock JWT utils
vi.mock('@/lib/utils/jwt-utils', () => ({
  extractCustomerId: vi.fn().mockReturnValue('customer-123'),
  decodeJWT: vi.fn().mockReturnValue({ cid: 'customer-123' })
}))

describe('V2ControlPlaneAdapter with Cache', function adapterCacheTests() {
  let adapter: V2ControlPlaneAdapter
  const mockJwt = 'mock.jwt.token'

  beforeEach(function setup() {
    adapter = new V2ControlPlaneAdapter()

    // Reset cache state completely
    const store = useSubscriptionCacheStore.getState()
    store.invalidate()
    useSubscriptionCacheStore.setState({
      cacheHits: 0,
      cacheMisses: 0,
      isRefreshing: false,
      customerId: undefined,
      lastRefresh: undefined
    })

    // Reset all mocks
    vi.clearAllMocks()
  })

  afterEach(function cleanup() {
    vi.clearAllMocks()
  })

  it('should use cached IDs for direct lookup', async function directLookup() {
    // Pre-populate cache
    useSubscriptionCacheStore.setState((state) => {
      state.appToSubscription.set('test-app-id', 'sub-1')
      state.appToSystem.set('test-app-id', 'sys-sub-1-1')
      state.customerId = 'customer-123'
      state.lastRefresh = Date.now()
    })

    const site = await adapter.getSite('test-app-id', mockJwt)
    const store = useSubscriptionCacheStore.getState()

    // Should make direct API call using cached IDs
    expect(mockClient.getApp).toHaveBeenCalledTimes(1)
    expect(mockClient.getApp).toHaveBeenCalledWith('sub-1', 'sys-sub-1-1', 'test-app-id', false)

    // Should NOT call the expensive search methods
    expect(mockClient.getSubscriptions).toHaveBeenCalledTimes(0)
    expect(mockClient.getSystems).toHaveBeenCalledTimes(0)
    expect(mockClient.getAppsForSystem).toHaveBeenCalledTimes(0)

    expect(site).not.toBe(null)
    expect(site?.id).toBe('test-app-id')
    expect(store.cacheHits).toBe(1)
  })

  it('should fallback to full search on cache miss', async function cacheMissSearch() {
    // Empty cache - will trigger full search
    const site = await adapter.getSite('test-app-id', mockJwt)

    // Should initialize cache (calls getCustomerTree)
    expect(mockClient.getCustomerTree).toHaveBeenCalled()

    // Should find the app and get full details
    expect(mockClient.getApp).toHaveBeenCalledWith('sub-1', 'sys-sub-1-1', 'test-app-id', false)

    expect(site).not.toBe(null)
    expect(site?.id).toBe('test-app-id')

    // Verify cache was populated after initialization
    const store = useSubscriptionCacheStore.getState()
    expect(store.customerId).toBe('customer-123')
    expect(store.appToSubscription.has('test-app-id')).toBe(true)
  })

  it('should handle 404 error and invalidate cache entry', async function handle404() {
    // Use a 10-char ID to ensure it's treated as an app ID, not a job ID (APP_ID_LENGTH = 10)
    const deletedAppId = 'deleted123' // Exactly 10 chars

    // Pre-populate cache with stale data
    useSubscriptionCacheStore.setState((state) => {
      state.appToSubscription.set(deletedAppId, 'sub-1')
      state.appToSystem.set(deletedAppId, 'sys-sub-1-1')
      state.customerId = 'customer-123'
      state.lastRefresh = Date.now()
    })

    // Mock 404 error for getApp calls with deleted app
    mockClient.getApp.mockImplementation(async (subId: string, sysId: string, appId: string) => {
      if (appId === deletedAppId) {
        const error: any = new Error('App not found')
        error.status = 404
        throw error
      }
      // Default behavior for other apps
      return {
        id: appId,
        systemId: sysId,
        subscriptionId: subId,
        status: 'active',
        variables: { title: 'Test App', initialPrompt: 'Test prompt' },
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      }
    })

    // Mock getAppsForSystem to not include deleted app
    mockClient.getAppsForSystem.mockImplementation(async () => {
      // Don't return deleted app in the list
      return []
    })

    const site = await adapter.getSite(deletedAppId, mockJwt)

    // Should have tried direct lookup first
    expect(mockClient.getApp).toHaveBeenCalledWith('sub-1', 'sys-sub-1-1', deletedAppId, false)

    // Should have removed the app from cache after 404
    const store = useSubscriptionCacheStore.getState()
    expect(store.appToSubscription.has(deletedAppId)).toBe(false)
    expect(store.appToSystem.has(deletedAppId)).toBe(false)

    // Should return null for deleted app
    expect(site).toBe(null)
  })

  it('should refresh stale cache automatically', async function refreshStaleCache() {
    // Set up stale cache (older than TTL) with some app data
    const staleTime = Date.now() - (16 * 60 * 1000) // 16 minutes ago (TTL is 15 minutes)

    useSubscriptionCacheStore.setState((state) => {
      state.customerId = 'customer-123'
      state.lastRefresh = staleTime
      // Add app to cache so it uses the stale refresh path
      state.appToSubscription.set('test-app-id', 'sub-1')
      state.appToSystem.set('test-app-id', 'sys-sub-1-1')
    })

    await adapter.getSite('test-app-id', mockJwt)

    // Refresh happens in background (non-blocking), so we need to wait a bit
    // TODO: Consider mocking the background refresh to make this test more deterministic
    await new Promise(resolve => setTimeout(resolve, 50))

    // Should have triggered cache refresh due to stale data
    expect(mockClient.getCustomerTree).toHaveBeenCalled()
  })

  it('should not refresh fresh cache', async function skipFreshCache() {
    // Set up fresh cache
    useSubscriptionCacheStore.setState((state) => {
      state.appToSubscription.set('test-app-id', 'sub-1')
      state.appToSystem.set('test-app-id', 'sys-sub-1-1')
      state.customerId = 'customer-123'
      state.lastRefresh = Date.now() - (2 * 60 * 1000) // 2 minutes ago (within TTL)
    })

    await adapter.getSite('test-app-id', mockJwt)

    // Should use cache without refreshing
    expect(mockClient.getApp).toHaveBeenCalledTimes(1)
    expect(mockClient.getSubscriptions).toHaveBeenCalledTimes(0)
    expect(mockClient.getSystems).toHaveBeenCalledTimes(0)
  })

  it('should handle job ID lookup for creating sites', async function jobIdLookup() {
    // Mock job ID response
    mockClient.getAiroJobApps.mockResolvedValueOnce({
      apps: [{
        id: 'job-123',
        systemId: 'sys-1',
        subscriptionId: 'sub-1',
        variables: { title: 'Creating...', initialPrompt: 'Test' }
      }]
    })

    // Use short ID that looks like job ID
    const site = await adapter.getSite('job123', mockJwt)

    expect(mockClient.getAiroJobApps).toHaveBeenCalledWith('job123')
    expect(site).not.toBe(null)
    expect(site?.id).toBe('job-123')
  })

  it('should measure performance improvement', async function measurePerformance() {
    // First call - cache miss (should initialize cache and fetch app)
    await adapter.getSite('test-app-id', mockJwt)

    const apiCallsFirstRun = mockClient.getCustomerTree.mock.calls.length +
                            mockClient.getApp.mock.calls.length

    // Get metrics after first call
    let store = useSubscriptionCacheStore.getState()
    const cacheHitsAfterFirst = store.cacheHits

    // Reset mocks for second call (but not the store state)
    vi.clearAllMocks()

    // Second call - cache hit (should use cached location for direct getApp)
    await adapter.getSite('test-app-id', mockJwt)

    const apiCallsSecondRun = mockClient.getCustomerTree.mock.calls.length +
                             mockClient.getApp.mock.calls.length

    // Get final metrics
    store = useSubscriptionCacheStore.getState()

    // Cache hit should make fewer API calls
    // First run: getCustomerTree + getApp = 2 calls
    // Second run: getApp only = 1 call
    expect(apiCallsFirstRun).toBeGreaterThan(0) // Ensure first run made API calls
    expect(apiCallsSecondRun).toBeLessThan(apiCallsFirstRun)
    expect(apiCallsSecondRun).toBe(1) // Only getApp on cache hit

    // Cache metrics should show improvement
    expect(store.cacheHits).toBeGreaterThan(cacheHitsAfterFirst)
  })

  describe('appExists', function appExistsTests() {
    it('should return true when app is in subscription cache', async function cacheHit() {
      // Pre-populate cache
      useSubscriptionCacheStore.setState((state) => {
        state.appToSubscription.set('test-app-id', 'sub-1')
        state.appToSystem.set('test-app-id', 'sys-sub-1-1')
        state.customerId = 'customer-123'
        state.lastRefresh = Date.now()
      })

      const exists = await adapter.appExists('test-app-id', mockJwt)

      expect(exists).toBe(true)
      // Should NOT call getApp — just cache lookup
      expect(mockClient.getApp).not.toHaveBeenCalled()
    })

    it('should return true for APP_ID_LENGTH siteId after forced refresh finds it', async function refreshFindsApp() {
      const appId = 'newapp1234' // exactly 10 chars (APP_ID_LENGTH)

      // Initialized cache without the target app
      useSubscriptionCacheStore.setState((state) => {
        state.customerId = 'customer-123'
        state.lastRefresh = Date.now()
      })

      // Refresh returns the new app
      mockClient.getCustomerTree.mockResolvedValueOnce({
        customerId: 'customer-123',
        subscriptions: [{
          subscriptionId: 'sub-1',
          status: 'active',
          systems: [{
            systemId: 'sys-sub-1-1',
            apps: [{ id: appId }]
          }]
        }]
      })

      const exists = await adapter.appExists(appId, mockJwt)

      expect(exists).toBe(true)
      expect(mockClient.getCustomerTree).toHaveBeenCalled()
      expect(mockClient.getApp).not.toHaveBeenCalled()
    })

    it('should return false for APP_ID_LENGTH siteId not found after refresh', async function refreshNotFound() {
      const appId = 'missing123' // exactly 10 chars

      // Initialized cache
      useSubscriptionCacheStore.setState((state) => {
        state.customerId = 'customer-123'
        state.lastRefresh = Date.now()
      })

      const exists = await adapter.appExists(appId, mockJwt)

      expect(exists).toBe(false)
      // Should have attempted a refresh
      expect(mockClient.getCustomerTree).toHaveBeenCalled()
    })

    it('should use job lookup for non-APP_ID_LENGTH siteIds', async function jobLookup() {
      // Initialized cache
      useSubscriptionCacheStore.setState((state) => {
        state.customerId = 'customer-123'
        state.lastRefresh = Date.now()
      })

      mockClient.getAiroJobApps.mockResolvedValueOnce({
        apps: [{ id: 'real-app-id', systemId: 'sys-1', subscriptionId: 'sub-1' }]
      })

      // Short ID (not APP_ID_LENGTH) → job lookup
      const exists = await adapter.appExists('job123', mockJwt)

      expect(exists).toBe(true)
      expect(mockClient.getAiroJobApps).toHaveBeenCalledWith('job123')
    })

    it('should initialize cache on cold BFF', async function coldBff() {
      // Empty cache (cold BFF)
      await adapter.appExists('test-app-id', mockJwt)

      // Should initialize cache via getCustomerTree
      expect(mockClient.getCustomerTree).toHaveBeenCalled()
      const store = useSubscriptionCacheStore.getState()
      expect(store.customerId).toBe('customer-123')
    })
  })

  it('should update cache on successful delete', async function updateCacheOnDelete() {
    // Pre-populate cache
    useSubscriptionCacheStore.setState((state) => {
      state.appToSubscription.set('test-app-id', 'sub-1')
      state.appToSystem.set('test-app-id', 'sys-1')
    })

    // Mock successful delete
    mockClient.deleteApp = vi.fn().mockResolvedValue({})

    const result = await adapter.deleteSite('test-app-id', mockJwt, 'sys-1', 'sub-1')

    expect(result.success).toBe(true)

    // Should have removed app from cache (cache is invalidated and refreshed)
    // After invalidate + refresh, the app won't be in cache anymore
    const store = useSubscriptionCacheStore.getState()
    expect(store.appToSubscription.size).toBe(1) // Should have test-app-id from getCustomerTree mock
    expect(store.appToSystem.size).toBe(1)
  })
})

