import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest'
import { useSubscriptionCacheStore } from '../useSubscriptionCacheStore'

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
            apps: [
              { id: 'app-sub-1-sys-sub-1-1-1' },
              { id: 'app-sub-1-sys-sub-1-1-2' }
            ]
          },
          {
            systemId: 'sys-sub-1-2',
            apps: [
              { id: 'app-sub-1-sys-sub-1-2-1' },
              { id: 'app-sub-1-sys-sub-1-2-2' }
            ]
          }
        ]
      },
      {
        subscriptionId: 'sub-2',
        status: 'active',
        systems: [
          {
            systemId: 'sys-sub-2-1',
            apps: [
              { id: 'app-sub-2-sys-sub-2-1-1' },
              { id: 'app-sub-2-sys-sub-2-1-2' }
            ]
          },
          {
            systemId: 'sys-sub-2-2',
            apps: [
              { id: 'app-sub-2-sys-sub-2-2-1' },
              { id: 'app-sub-2-sys-sub-2-2-2' }
            ]
          }
        ]
      }
    ]
  })
}

// Mock the import
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

describe('useSubscriptionCacheStore', function storeTests() {
  beforeEach(function setup() {
    // Reset store state before each test
    const store = useSubscriptionCacheStore.getState()
    store.invalidate()
    
    // Reset metrics
    useSubscriptionCacheStore.setState({
      cacheHits: 0,
      cacheMisses: 0,
      isRefreshing: false
    })
  })

  afterEach(function cleanup() {
    vi.clearAllMocks()
  })

  it('should initialize cache from API', async function initialize() {
    const mockJwt = 'mock.jwt.token'
    
    await useSubscriptionCacheStore.getState().initialize(mockJwt)
    
    // Get the state AFTER initialization completes
    const store = useSubscriptionCacheStore.getState()
    expect(store.customerId).toBe('customer-123')
    expect(store.subscriptions.size).toBe(2)
    expect(store.appToSubscription.size).toBe(8) // 2 subs * 2 systems * 2 apps
    expect(store.appToSystem.size).toBe(8)
    expect(typeof store.lastRefresh).toBe('number')
  })

  it('should return app location from cache', function getLocation() {
    // Manually populate cache using setState with immer
    useSubscriptionCacheStore.setState((state) => {
      state.appToSubscription.set('test-app-id', 'sub-123')
      state.appToSystem.set('test-app-id', 'sys-456')
    })
    
    const store = useSubscriptionCacheStore.getState()
    const location = store.getAppLocation('test-app-id')
    
    expect(location).toEqual({
      subscriptionId: 'sub-123',
      systemId: 'sys-456'
    })
    expect(useSubscriptionCacheStore.getState().cacheHits).toBe(1)
  })

  it('should return null for cache miss', function cacheMiss() {
    const store = useSubscriptionCacheStore.getState()
    const location = store.getAppLocation('unknown-app-id')
    
    expect(location).toBe(null)
    expect(useSubscriptionCacheStore.getState().cacheMisses).toBe(1)
  })

  it('should not refresh if cache is fresh', async function skipRefresh() {
    const store = useSubscriptionCacheStore.getState()
    const mockJwt = 'mock.jwt.token'
    
    // Set recent refresh time
    useSubscriptionCacheStore.setState({
      lastRefresh: Date.now(),
      customerId: 'customer-123'
    })
    
    const initialRefreshTime = store.lastRefresh
    
    await store.refresh(mockJwt, false)
    
    // Should not have refreshed
    expect(store.lastRefresh).toBe(initialRefreshTime)
  })

  it('should force refresh when requested', async function forceRefresh() {
    const mockJwt = 'mock.jwt.token'
    
    // Set old refresh time
    const oldTime = Date.now() - (10 * 60 * 1000) // 10 minutes ago
    useSubscriptionCacheStore.setState({
      lastRefresh: oldTime,
      customerId: 'customer-123'
    })
    
    await useSubscriptionCacheStore.getState().refresh(mockJwt, true)
    
    // Should have refreshed
    const newRefreshTime = useSubscriptionCacheStore.getState().lastRefresh
    expect(newRefreshTime).toBeGreaterThan(oldTime)
  })

  it('should invalidate cache completely', function invalidate() {
    // Populate cache using setState
    useSubscriptionCacheStore.setState((state) => {
      state.subscriptions.set('sub-1', {
        id: 'sub-1',
        status: 'active',
        systems: new Map()
      })
      state.appToSubscription.set('app-1', 'sub-1')
      state.appToSystem.set('app-1', 'sys-1')
      state.lastRefresh = Date.now()
    })
    
    useSubscriptionCacheStore.getState().invalidate()
    
    const store = useSubscriptionCacheStore.getState()
    expect(store.subscriptions.size).toBe(0)
    expect(store.appToSubscription.size).toBe(0)
    expect(store.appToSystem.size).toBe(0)
    expect(store.lastRefresh).toBe(null)
  })

  it('should remove single app from cache', function removeApp() {
    // Populate cache with subscription and system using setState
    useSubscriptionCacheStore.setState((state) => {
      const systemsMap = new Map()
      const appIds = new Set(['app-1', 'app-2'])
      systemsMap.set('sys-1', {
        id: 'sys-1',
        name: 'System 1',
        appIds
      })
      
      state.subscriptions.set('sub-1', {
        id: 'sub-1',
        status: 'active',
        systems: systemsMap
      })
      
      state.appToSubscription.set('app-1', 'sub-1')
      state.appToSystem.set('app-1', 'sys-1')
      state.appToSubscription.set('app-2', 'sub-1')
      state.appToSystem.set('app-2', 'sys-1')
    })
    
    useSubscriptionCacheStore.getState().removeAppFromCache('app-1')
    
    const store = useSubscriptionCacheStore.getState()
    
    // app-1 should be removed
    expect(store.appToSubscription.has('app-1')).toBe(false)
    expect(store.appToSystem.has('app-1')).toBe(false)
    
    // app-2 should still exist
    expect(store.appToSubscription.has('app-2')).toBe(true)
    expect(store.appToSystem.has('app-2')).toBe(true)
    
    // System should have app-1 removed from appIds
    const system = store.subscriptions.get('sub-1')?.systems.get('sys-1')
    expect(system?.appIds.has('app-1')).toBe(false)
    expect(system?.appIds.has('app-2')).toBe(true)
  })

  it('should handle concurrent refresh requests', async function concurrentRefresh() {
    const store = useSubscriptionCacheStore.getState()
    const mockJwt = 'mock.jwt.token'
    
    // Start two refresh operations simultaneously
    const refresh1 = store.refresh(mockJwt, false)
    const refresh2 = store.refresh(mockJwt, false)
    
    await Promise.all([refresh1, refresh2])
    
    // Should have completed successfully without conflicts
    expect(store.isRefreshing).toBe(false)
    expect(store.customerId).toBe('customer-123')
  })

  it('should calculate hit rate correctly', function hitRate() {
    // Simulate cache operations
    useSubscriptionCacheStore.setState((state) => {
      state.cacheHits = 8
      state.cacheMisses = 2
      // Manually populate cache for hit
      state.appToSubscription.set('hit-app', 'sub-1')
      state.appToSystem.set('hit-app', 'sys-1')
    })
    
    const store = useSubscriptionCacheStore.getState()
    const hitLocation = store.getAppLocation('hit-app')
    const missLocation = store.getAppLocation('miss-app')
    
    expect(hitLocation).not.toBe(null)
    expect(missLocation).toBe(null)
    
    // Final stats: 9 hits, 3 misses = 75% hit rate
    const finalStore = useSubscriptionCacheStore.getState()
    const totalRequests = finalStore.cacheHits + finalStore.cacheMisses
    const hitRate = (finalStore.cacheHits / totalRequests) * 100
    
    expect(hitRate).toBe(75)
  })
})
