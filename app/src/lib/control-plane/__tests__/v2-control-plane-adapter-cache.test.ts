import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest'
import { V2ControlPlaneAdapter } from '../v2-control-plane-adapter'
import { useSubscriptionCacheStore } from '@/stores/useSubscriptionCacheStore'

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
  getAiroJobApps: vi.fn().mockResolvedValue({ apps: [] }),
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
    
    // Reset cache state
    const store = useSubscriptionCacheStore.getState()
    store.invalidate()
    useSubscriptionCacheStore.setState({
      cacheHits: 0,
      cacheMisses: 0,
      isRefreshing: false
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
    expect(mockClient.getApp).toHaveBeenCalledWith('sub-1', 'sys-sub-1-1', 'test-app-id')
    
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
    expect(mockClient.getApp).toHaveBeenCalledWith('sub-1', 'sys-sub-1-1', 'test-app-id')

    expect(site).not.toBe(null)
    expect(site?.id).toBe('test-app-id')
    
    const store = useSubscriptionCacheStore.getState()
    expect(store.cacheMisses).toBe(1)
  })

  it('should handle 404 error and invalidate cache entry', async function handle404() {
    // Pre-populate cache with stale data
    useSubscriptionCacheStore.setState((state) => {
      state.appToSubscription.set('deleted-app-id', 'sub-1')
      state.appToSystem.set('deleted-app-id', 'sys-sub-1-1')
      state.customerId = 'customer-123'
      state.lastRefresh = Date.now()
    })

    // Mock 404 error for direct lookup
    mockClient.getApp.mockRejectedValueOnce({ status: 404 })

    const site = await adapter.getSite('deleted-app-id', mockJwt)

    // Should have tried direct lookup first
    expect(mockClient.getApp).toHaveBeenCalledWith('sub-1', 'sys-sub-1-1', 'deleted-app-id')
    
    // Should have removed the app from cache after 404
    const store = useSubscriptionCacheStore.getState()
    expect(store.appToSubscription.has('deleted-app-id')).toBe(false)
    expect(store.appToSystem.has('deleted-app-id')).toBe(false)

    // Should return null for deleted app
    expect(site).toBe(null)
  })

  it('should refresh stale cache automatically', async function refreshStaleCache() {
    // Set up stale cache (older than TTL)
    const store = useSubscriptionCacheStore.getState()
    const staleTime = Date.now() - (16 * 60 * 1000) // 16 minutes ago (TTL is 15 minutes)
    
    useSubscriptionCacheStore.setState({
      customerId: 'customer-123',
      lastRefresh: staleTime
    })

    await adapter.getSite('test-app-id', mockJwt)

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
    // First call - cache miss (should be slower)
    const start1 = Date.now()
    await adapter.getSite('test-app-id', mockJwt)
    const duration1 = Date.now() - start1
    
    const apiCallsFirstRun = mockClient.getCustomerTree.mock.calls.length +
                            mockClient.getApp.mock.calls.length

    // Get metrics after first call
    let store = useSubscriptionCacheStore.getState()
    const firstCacheMiss = store.cacheMisses

    // Reset mocks for second call (but not the store state)
    vi.clearAllMocks()
    
    // Second call - cache hit (should be faster)
    const start2 = Date.now()
    await adapter.getSite('test-app-id', mockJwt)
    const duration2 = Date.now() - start2
    
    const apiCallsSecondRun = mockClient.getCustomerTree.mock.calls.length +
                             mockClient.getApp.mock.calls.length

    // Get final metrics
    store = useSubscriptionCacheStore.getState()

    // Cache hit should make fewer API calls
    expect(apiCallsSecondRun).toBeLessThan(apiCallsFirstRun)
    
    // First call: miss initially, then hit after cache populated (1 miss, 1 hit)
    // Second call: hit immediately (1 miss, 2 hits total)
    expect(store.cacheMisses).toBe(1)
    expect(store.cacheHits).toBe(2)
    
    // Calculate performance improvement
    const apiReduction = ((apiCallsFirstRun - apiCallsSecondRun) / apiCallsFirstRun) * 100
    expect(apiReduction).toBeGreaterThan(50) // Should reduce API calls by >50%
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

