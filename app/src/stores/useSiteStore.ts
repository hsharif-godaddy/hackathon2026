import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

export interface Site {
  id: string
  name: string
  status: 'init' | 'creating' | 'created' | 'running' | 'stopped' | 'error' | 'failed'
  agent_url?: string
  backend_url?: string
  preview_url?: string
  account_id: string
  created_at: string
  updated_at: string
  initial_prompt?: string
}

interface SiteStore {
  // State
  sites: Record<string, Site> // Keyed by site ID for efficient lookups
  loading: Record<string, boolean> // Loading state per site
  error: string | null

  // Actions
  fetchSite: (siteId: string) => Promise<Site | null>
  updateSite: (siteId: string, updates: Partial<Site>) => void
  getSite: (siteId: string) => Site | null
  clearError: () => void
  cleanup: () => void
}

export const useSiteStore = create<SiteStore>()(
  immer((set, get) => ({
    // Initial state
    sites: {},
    loading: {},
    error: null,

    // Fetch site data from API
    fetchSite: async (siteId: string) => {
      const { sites, loading } = get()

      // Return cached site if we have it and it's not stale
      const existingSite = sites[siteId]
      if (existingSite && !loading[siteId]) {
        return existingSite
      }

      // Prevent duplicate requests
      if (loading[siteId]) {
        // Wait for existing request to complete
        return new Promise((resolve) => {
          const checkForSite = () => {
            const currentState = get()
            if (!currentState.loading[siteId]) {
              resolve(currentState.sites[siteId] || null)
            } else {
              setTimeout(checkForSite, 100)
            }
          }
          checkForSite()
        })
      }

      set((state) => {
        state.loading[siteId] = true
        state.error = null
      })

      try {
        logger.debug('site-store.fetch.start', { message: 'Fetching site data', siteId })

        const response = await appFetch(`/api/sites/${siteId}`)

        if (!response.ok) {
          throw new Error(`Failed to fetch site: ${response.status} ${response.statusText}`)
        }

        const siteData = await response.json()
        logger.info('site-store.fetch.success', { message: 'Site data fetched', siteName: siteData.name })

        set((state) => {
          state.sites[siteId] = siteData
          state.loading[siteId] = false
        })

        return siteData

      } catch (error) {
        logger.error('site-store.fetch.failure', { message: 'Failed to fetch site', siteId, error: error instanceof Error ? error.message : String(error) })

        set((state) => {
          state.loading[siteId] = false
          state.error = error instanceof Error ? error.message : 'Failed to fetch site'
        })

        return null
      }
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
      })
    }
  }))
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
