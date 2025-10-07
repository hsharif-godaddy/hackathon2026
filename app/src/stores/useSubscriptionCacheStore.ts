import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'
import { logger } from '@/lib/request-context'

// Enable Immer MapSet plugin for handling Map and Set objects
enableMapSet()

interface SystemData {
  id: string
  name: string
  appIds: Set<string> // App IDs in this system
}

interface SubscriptionData {
  id: string
  status: string
  systems: Map<string, SystemData> // Key: systemId
}

export interface AppLocation {
  subscriptionId: string
  systemId: string
}

interface SubscriptionCacheStore {
  // Cache state
  customerId: string | null
  subscriptions: Map<string, SubscriptionData> // Key: subscriptionId
  appToSubscription: Map<string, string> // Key: appId, Value: subscriptionId
  appToSystem: Map<string, string> // Key: appId, Value: systemId
  lastRefresh: number | null
  isRefreshing: boolean
  
  // Cache metrics
  cacheHits: number
  cacheMisses: number
  
  // Cache configuration
  CACHE_TTL: number // 15 minutes
  
  // Actions
  initialize: (jwt: string) => Promise<void>
  refresh: (jwt: string, force?: boolean) => Promise<void>
  getAppLocation: (appId: string) => AppLocation | null
  invalidate: () => void
  removeAppFromCache: (appId: string) => void
  
  // Internal helpers
  _buildCache: (subscriptions: any[]) => Promise<void>
}

export const useSubscriptionCacheStore = create<SubscriptionCacheStore>()(
  devtools(
    immer((set, get) => ({
    // Initial state
    customerId: null,
    subscriptions: new Map(),
    appToSubscription: new Map(),
    appToSystem: new Map(),
    lastRefresh: null,
    isRefreshing: false,
    cacheHits: 0,
    cacheMisses: 0,
    CACHE_TTL: 15 * 60 * 1000, // 15 minutes
    
    // Initialize cache on first use
    initialize: async (jwt: string) => {
      const state = get()
      if (state.customerId) return // Already initialized
      
      logger.info('subscription-cache.init.start')
      await get().refresh(jwt, true)
    },
    
    // Refresh cache from API
    refresh: async (jwt: string, force: boolean = false) => {
      const state = get()
      
      // Skip if already refreshing
      if (state.isRefreshing && !force) {
        logger.debug('subscription-cache.refresh.skip-already-refreshing')
        return
      }
      
      // Skip if cache is fresh
      if (!force && state.lastRefresh && 
          Date.now() - state.lastRefresh < state.CACHE_TTL) {
        logger.debug('subscription-cache.refresh.skip-cache-fresh', {
          age: Date.now() - state.lastRefresh,
          ttl: state.CACHE_TTL
        })
        return
      }
      
      set((state) => { state.isRefreshing = true })
      const startTime = Date.now()
      
      try {
        const { AiroMgmtClient } = await import('@/lib/mgmt-airo/client')
        const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net'
        const client = new AiroMgmtClient({ baseUrl, jwt })
        
        logger.info('subscription-cache.refresh.fetching')
        
        // ONE API CALL - replaces 119 sequential calls! 🚀
        const treeStart = Date.now()
        logger.info('subscription-cache.refresh.fetching-tree', {
          message: '🔍 [CACHE] Fetching customer tree (replaces 119 API calls)...'
        })
        const tree = await client.getCustomerTree()
        const treeDuration = Date.now() - treeStart
        logger.info('subscription-cache.refresh.tree-fetched', {
          message: `✅ [CACHE] Customer tree fetched in ${treeDuration}ms (was 28+ seconds!)`,
          duration: treeDuration
        })
        
        // Debug: Log tree structure to identify the apps issue
        const totalSystems = tree.subscriptions.reduce((sum, sub) => sum + sub.systems.length, 0)
        const totalApps = tree.subscriptions.reduce((sum, sub) => 
          sum + sub.systems.reduce((sysSum, sys) => sysSum + sys.apps.length, 0), 0
        )
        
        logger.debug('subscription-cache.refresh.tree-structure', {
          subscriptions: tree.subscriptions.length,
          systems: totalSystems,
          apps: totalApps,
          firstSubscription: tree.subscriptions[0] ? {
            id: tree.subscriptions[0].subscriptionId,
            systemCount: tree.subscriptions[0].systems.length,
            firstSystem: tree.subscriptions[0].systems[0] ? {
              id: tree.subscriptions[0].systems[0].systemId,
              appCount: tree.subscriptions[0].systems[0].apps.length
            } : null
          } : null
        })
        
        logger.info('subscription-cache.refresh.building-maps', {
          customerId: tree.customerId,
          subscriptionCount: tree.subscriptions.length,
          treeFetchDuration: treeDuration,
          totalSystems,
          totalApps
        })
        
        // Build cache maps from tree data
        const subsMap = new Map<string, SubscriptionData>()
        const appToSub = new Map<string, string>()
        const appToSys = new Map<string, string>()
        
        // Process tree data (O(n) complexity - much faster than nested API calls)
        const appDataMap = new Map<string, any>() // Store complete app data
        
        for (const sub of tree.subscriptions) {
          const systemsMap = new Map<string, SystemData>()
          
          for (const system of sub.systems) {
            const appIds = new Set(system.apps.map(app => app.id))
            
            // Map each app to its subscription and system
            for (const app of system.apps) {
              appToSub.set(app.id, sub.subscriptionId)
              appToSys.set(app.id, system.systemId)
              
              // Store complete app data if available (for future optimization)
              if (app.variables && app.urls) {
                appDataMap.set(app.id, app)
              }
            }
            
            systemsMap.set(system.systemId, {
              id: system.systemId,
              name: system.systemId,
              appIds
            })
          }
          
          subsMap.set(sub.subscriptionId, {
            id: sub.subscriptionId,
            status: sub.status,
            systems: systemsMap
          })
        }
        
        // Debug: Check if tree has complete app data
        logger.debug('subscription-cache.refresh.app-data-check', {
          message: `🔍 [CACHE DEBUG] Complete app data available for ${appDataMap.size}/${totalApps} apps`,
          completeApps: appDataMap.size,
          totalApps
        })
        if (appDataMap.size > 0) {
          const sampleApp = Array.from(appDataMap.values())[0]
          logger.debug('subscription-cache.refresh.sample-app-data', {
            hasUrls: !!sampleApp.urls,
            hasVariables: !!sampleApp.variables,
            urlKeys: sampleApp.urls ? Object.keys(sampleApp.urls) : [],
            variableKeys: sampleApp.variables ? Object.keys(sampleApp.variables) : []
          })
        }
        
        set((state) => {
          state.customerId = tree.customerId
          state.subscriptions = subsMap
          state.appToSubscription = appToSub
          state.appToSystem = appToSys
          state.lastRefresh = Date.now()
          state.isRefreshing = false
        })
        
        const duration = Date.now() - startTime
        const finalSystemCount = Array.from(subsMap.values())
          .reduce((sum, sub) => sum + sub.systems.size, 0)
        const finalAppCount = appToSub.size
        
        logger.info('subscription-cache.refresh.complete', {
          duration,
          treeFetchDuration: treeDuration,
          subscriptions: subsMap.size,
          systems: finalSystemCount,
          apps: finalAppCount,
          performanceImprovement: `${Math.round((28000 - treeDuration) / 28000 * 100)}% faster than sequential calls`
        })
        
        logger.info('subscription-cache.refresh.performance', {
          message: `🎉 [CACHE] Performance improvement: ${treeDuration}ms vs ~28s`,
          treeDuration,
          percentFaster: Math.round((28000 - treeDuration) / 28000 * 100)
        })
        logger.info('subscription-cache.refresh.final-cache-state', {
          subscriptions: subsMap.size,
          systems: finalSystemCount,
          apps: finalAppCount
        })
        
      } catch (error) {
        logger.error('subscription-cache.refresh.error', { 
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime
        })
        set((state) => { state.isRefreshing = false })
      }
    },
    
    // Get app location from cache
    getAppLocation: (appId: string): AppLocation | null => {
      const state = get()
      const subscriptionId = state.appToSubscription.get(appId)
      const systemId = state.appToSystem.get(appId)
      
      if (subscriptionId && systemId) {
        set((state) => { state.cacheHits++ })
        logger.debug('subscription-cache.hit', { 
          appId, 
          subscriptionId, 
          systemId,
          hitRate: state.cacheHits / (state.cacheHits + state.cacheMisses) * 100
        })
        return { subscriptionId, systemId }
      }
      
      set((state) => { state.cacheMisses++ })
      logger.debug('subscription-cache.miss', { 
        appId,
        hitRate: state.cacheHits / (state.cacheHits + state.cacheMisses) * 100
      })
      return null
    },
    
    // Invalidate cache (force refresh on next request)
    invalidate: () => {
      logger.info('subscription-cache.invalidate')
      set((state) => {
        state.subscriptions.clear()
        state.appToSubscription.clear()
        state.appToSystem.clear()
        state.lastRefresh = null
      })
    },
    
    // Remove a single app from cache
    removeAppFromCache: (appId: string) => {
      logger.info('subscription-cache.remove-app', { appId })
      set((state) => {
        const subscriptionId = state.appToSubscription.get(appId)
        const systemId = state.appToSystem.get(appId)
        
        if (subscriptionId && systemId) {
          const subscription = state.subscriptions.get(subscriptionId)
          if (subscription) {
            const system = subscription.systems.get(systemId)
            if (system) {
              system.appIds.delete(appId)
            }
          }
        }
        
        state.appToSubscription.delete(appId)
        state.appToSystem.delete(appId)
      })
    },
    
    // Build cache from subscription data
    _buildCache: async (_subscriptions: any[]) => {
      // Implementation details in refresh method above
    }
  })),
  { name: 'SubscriptionCache' }
  )
)
