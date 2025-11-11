import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'

// Use SiteInfo from the existing interface for consistency
export type Site = SiteInfo

interface SiteStore {
  // State
  sites: Record<string, Site> // Keyed by site ID for efficient lookups
  loading: Record<string, boolean> // Loading state per site
  error: string | null
  
  // Internal promise tracking for deduplication
  _pendingRequests: Record<string, Promise<Site | null>>

  // Actions
  fetchSite: (siteId: string, force?: boolean) => Promise<Site | null>
  updateSite: (siteId: string, updates: Partial<Site>) => void
  getSite: (siteId: string) => Site | null
  clearError: () => void
  cleanup: () => void
}

export const useSiteStore = create<SiteStore>()(
  devtools(
    immer((set, get) => ({
    // Initial state
    sites: {},
    loading: {},
    error: null,
    _pendingRequests: {},

    // Fetch site data from API with promise-based deduplication
    fetchSite: async (siteId: string, force: boolean = false) => {
      const state = get()

      // Return cached site if we have it and it's not currently being fetched (unless force=true)
      const existingSite = state.sites[siteId]
      if (existingSite && !state.loading[siteId] && !force) {
        logger.debug('site-store.fetch.cached', { message: 'Returning cached site data', siteId })
        return existingSite
      }
      
      if (force && existingSite) {
        logger.debug('site-store.fetch.force-refresh', { message: 'Force refreshing site data', siteId })
      }

      // If there's already a pending request for this siteId, return that promise
      const existingRequest = state._pendingRequests[siteId]
      if (existingRequest) {
        logger.debug('site-store.fetch.dedup', { message: 'Request already in flight, waiting for existing request', siteId })
        return existingRequest
      }

      // Create new request promise
      const requestPromise = (async () => {
        set((state) => {
          state.loading[siteId] = true
          state.error = null
        })

        try {
          logger.debug('site-store.fetch.start', { message: 'Starting new site data fetch', siteId })

          const response = await appFetch(`/api/sites/${siteId}`)

          if (!response.ok) {
            throw new Error(`Failed to fetch site: ${response.status} ${response.statusText}`)
          }

          const siteData = await response.json()
          logger.info('site-store.fetch.success', { message: 'Site data fetched successfully', siteId, siteName: siteData.name })

          set((state) => {
            state.sites[siteId] = siteData
            state.loading[siteId] = false
            // Clean up the pending request
            delete state._pendingRequests[siteId]
          })

          return siteData

        } catch (error) {
          logger.error('site-store.fetch.failure', { 
            message: 'Failed to fetch site data', 
            siteId, 
            error: error instanceof Error ? error.message : String(error) 
          })

          set((state) => {
            state.loading[siteId] = false
            state.error = error instanceof Error ? error.message : 'Failed to fetch site'
            // Clean up the pending request even on error
            delete state._pendingRequests[siteId]
          })

          return null
        }
      })()

      // Store the promise for deduplication
      set((state) => {
        state._pendingRequests[siteId] = requestPromise
      })

      return requestPromise
    },

    // Update site data (optimistic updates)
    updateSite: (siteId: string, updates: Partial<Site>) => {
      set((state) => {
        if (state.sites[siteId]) {
          Object.assign(state.sites[siteId], updates)
        }
      })
    },

    // Get site from cache
    getSite: (siteId: string) => {
      return get().sites[siteId] || null
    },

    // Clear error state
    clearError: () => {
      set((state) => {
        state.error = null
      })
    },

    // Cleanup store state
    cleanup: () => {
      set((state) => {
        state.sites = {}
        state.loading = {}
        state.error = null
        state._pendingRequests = {}
      })
    }
  })),
  { name: 'SiteStore' }
  )
)

// Helper hook to get site data with automatic fetching
export const useSite = (siteId: string | null) => {
  const { sites, loading, error, fetchSite } = useSiteStore()

  const site = siteId ? sites[siteId] : null
  const isLoading = siteId ? loading[siteId] : false

  // Auto-fetch site data when siteId changes
  const fetchSiteData = async () => {
    if (siteId && !site && !isLoading) {
      await fetchSite(siteId)
    }
  }

  return {
    site,
    isLoading,
    error,
    fetchSite: fetchSiteData,
    refetch: siteId ? () => fetchSite(siteId) : null
  }
}
