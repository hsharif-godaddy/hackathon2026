import React from 'react'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { SiteInfo, SiteStatus } from '@/lib/control-plane/types'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { AppErrorCode } from '@/types/error-codes'

// Use SiteInfo from the existing interface for consistency
export type Site = SiteInfo

/**
 * Sort sites for display on the apps page
 *
 * Sort precedence (highest to lowest priority):
 * 1. updated_at DESC - most recently interacted apps first
 * 2. created_at DESC - newest apps first (when updated_at is equal)
 * 3. id ASC - alphabetical tie-breaker for sort stability
 *
 * @param sites - Array of sites to sort
 * @returns NEW sorted array (triggers React re-renders)
 */
function sortSites(sites: Site[]): Site[] {
  return [...sites].sort((a, b) => {
    // Compare by updated_at DESC
    const updatedA = new Date(a.updated_at).getTime()
    const updatedB = new Date(b.updated_at).getTime()
    const updatedDiff = updatedB - updatedA
    if (updatedDiff !== 0) {
      return updatedDiff
    }
    // If updated_at is the same, sort by created_at DESC
    const createdA = new Date(a.created_at).getTime()
    const createdB = new Date(b.created_at).getTime()
    const createdDiff = createdB - createdA
    if (createdDiff !== 0) {
      return createdDiff
    }
    // Final tie-breaker: sort by id for stability
    return a.id.localeCompare(b.id)
  })
}

interface SitesStore {
  // State
  allSites: Site[]
  sitesById: Record<string, Site>
  isLoadingAll: boolean
  loadingById: Record<string, boolean>
  error: string | null
  lastFetchedAll: number | null
  /** True when sites list is empty because user needs to authenticate */
  requiresAuth: boolean

  // Bulk operations
  fetchAllSites: () => Promise<void>
  refreshSites: () => Promise<void>
  deleteSite: (siteId: string) => Promise<boolean>
  stopAllSites: () => Promise<boolean>
  deleteAllSites: () => Promise<boolean>

  // Individual operations
  fetchSite: (siteId: string) => Promise<Site | null>
  getSite: (siteId: string) => Site | null
  updateSite: (siteId: string, updates: Partial<Site>) => void

  // Computed getters
  getRunningSites: () => Site[]
  getTotalSites: () => number
  getRunningCount: () => number

  // Utility
  clearError: () => void
  clearRequiresAuth: () => void
  cleanup: () => void
}

export const useSitesStore = create<SitesStore>()(
  immer((set, get) => ({
    // Initial state
    allSites: [],
    sitesById: {},
    isLoadingAll: false,
    loadingById: {},
    error: null,
    lastFetchedAll: null,
    requiresAuth: false,

    // Fetch all sites from API
    fetchAllSites: async () => {
      const { isLoadingAll } = get()

      // Prevent duplicate requests
      if (isLoadingAll) return

      set((state) => {
        state.isLoadingAll = true
        state.error = null
        state.requiresAuth = false
      })

      try {
        // appFetch handles 401 gracefully - no auto-redirect, sets auth state in UI store.
        // This allows the homepage to work for unauthenticated users.
        const response = await appFetch('/api/sites')

        // Handle 401 gracefully - user needs to authenticate
        if (response.status === 401) {
          logger.debug('sites-store.fetch-all.requires-auth', {
            message: 'Sites fetch requires authentication',
            requiresRefresh: response.requiresRefresh
          })

          set((state) => {
            state.allSites = []
            state.sitesById = {}
            state.isLoadingAll = false
            // Don't set lastFetchedAll - leave it null so sites will auto-refetch after auth is restored
            state.requiresAuth = true
            // Don't set error - this is expected for unauthenticated users
          })
          return
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch sites: ${response.status} ${response.statusText}`)
        }

        const sitesData = await response.json()
        const sites = Array.isArray(sitesData) ? sitesData : []

        set((state) => {
          state.allSites = sites
          state.isLoadingAll = false
          state.lastFetchedAll = Date.now()
          state.requiresAuth = false

          // Update sitesById for consistency
          state.sitesById = {}
          sites.forEach(site => {
            state.sitesById[site.id] = site
          })

          // Sort sites after fetching (creates new array for React reactivity)
          state.allSites = sortSites(state.allSites)
        })

      } catch (error) {
        logger.error('sites-store.fetch-all.failure', {
          error: error instanceof Error ? error.message : String(error)
        })

        set((state) => {
          state.isLoadingAll = false
          state.error = error instanceof Error ? error.message : 'Failed to connect to server'
          // Set lastFetchedAll even on error to prevent infinite retry loops
          state.lastFetchedAll = Date.now();
        })
      }
    },

    // Refresh sites (public API for manual refresh)
    refreshSites: async () => {
      await get().fetchAllSites()
    },

    // Delete a single site
    deleteSite: async (siteId: string): Promise<boolean> => {
      try {
        set((state) => {
          state.error = null
        })

        const response = await appFetch(`/api/sites/${siteId}`, {
          method: 'DELETE'
        })

        if (response.ok) {

          set((state) => {
            // Remove from both collections
            state.allSites = state.allSites.filter(site => site.id !== siteId)
            delete state.sitesById[siteId]
            delete state.loadingById[siteId]
          })
          return true
        } else {
          const errorData = await response.json().catch(() => ({}))
          const errorMessage = errorData.error || 'Failed to delete site'
          logger.error('sites-store.delete.failure', { siteId, error: errorMessage })
          set((state) => {
            state.error = errorMessage
          })
          return false
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete site'
        logger.error('sites-store.delete.error', { siteId, error: errorMessage })

        set((state) => {
          state.error = errorMessage
        })
        return false
      }
    },

    // Stop all running sites
    stopAllSites: async (): Promise<boolean> => {
      const { allSites } = get()
      const runningSites = allSites.filter(site => site.status === SiteStatus.Running)

      if (runningSites.length === 0) {
        return true
      }

      try {
        set((state) => {
          state.error = null
        })

        // Stop all running sites in parallel
        const stopPromises = runningSites.map(site =>
          appFetch(`/api/sites/${site.id}/stop`, { method: 'POST' })
        )

        await Promise.all(stopPromises)

        // Update site statuses to stopped
        set((state) => {
          state.allSites.forEach(site => {
            if (site.status === SiteStatus.Running) {
              site.status = SiteStatus.Stopped
            }
          })

          // Update sitesById as well
          Object.values(state.sitesById).forEach(site => {
            if (site.status === SiteStatus.Running) {
              site.status = SiteStatus.Stopped
            }
          })
        })

        return true
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to stop all sites'
        logger.error('sites-store.stop-all.failure', { error: errorMessage })

        set((state) => {
          state.error = errorMessage
        })
        return false
      }
    },

    // Delete all sites
    deleteAllSites: async (): Promise<boolean> => {
      const { allSites } = get()

      if (allSites.length === 0) {
        return true
      }

      try {
        set((state) => {
          state.error = null
        })

        // Delete all sites in parallel
        const deletePromises = allSites.map(site =>
          appFetch(`/api/sites/${site.id}`, { method: 'DELETE' })
        )

        await Promise.all(deletePromises)

        // Clear all sites
        set((state) => {
          state.allSites = []
          state.sitesById = {}
          state.loadingById = {}
        })

        return true
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete all sites'
        logger.error('sites-store.delete-all.failure', { error: errorMessage })

        set((state) => {
          state.error = errorMessage
        })
        return false
      }
    },

    // Fetch individual site data from API
    fetchSite: async (siteId: string) => {
      const { sitesById, loadingById } = get()

      // Return cached site if we have it and it's not stale
      const existingSite = sitesById[siteId]
      if (existingSite && !loadingById[siteId]) {
        return existingSite
      }

      // Prevent duplicate requests
      if (loadingById[siteId]) {
        // Wait for existing request to complete
        return new Promise((resolve, reject) => {
          const checkForSite = () => {
            const currentState = get()
            if (!currentState.loadingById[siteId]) {
              const site = currentState.sitesById[siteId]
              if (site) {
                resolve(site)
              } else if (currentState.error) {
                reject(new Error(currentState.error))
              } else {
                resolve(null)
              }
            } else {
              setTimeout(checkForSite, 100)
            }
          }
          checkForSite()
        })
      }

      set((state) => {
        state.loadingById[siteId] = true
        state.error = null
      })

      try {
        const response = await appFetch(`/api/sites/${siteId}`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(AppErrorCode.SITE_NOT_FOUND)
          }
          throw new Error(`Failed to fetch site: ${response.status} ${response.statusText}`)
        }

        const siteData = await response.json()

        set((state) => {
          state.sitesById[siteId] = siteData
          state.loadingById[siteId] = false

          // Update allSites if it exists there
          const existingIndex = state.allSites.findIndex(site => site.id === siteId)
          if (existingIndex >= 0) {
            state.allSites[existingIndex] = siteData
            // Re-sort after updating (creates new array for React reactivity)
            state.allSites = sortSites(state.allSites)
          }
        })

        return siteData

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        logger.error('sites-store.fetch-site.failure', { siteId, error: errorMessage })

        set((state) => {
          state.loadingById[siteId] = false
          state.error = errorMessage
        })

        if (errorMessage === AppErrorCode.SITE_NOT_FOUND) {
          throw error
        }

        return null
      }
    },

    // Get site from cache
    getSite: (siteId: string) => {
      return get().sitesById[siteId] || null
    },

    // Update site data (optimistic updates)
    updateSite: (siteId: string, updates: Partial<Site>) => {
      set((state) => {
        // Update in sitesById
        if (state.sitesById[siteId]) {
          Object.assign(state.sitesById[siteId], updates)
        }

        // Update in allSites
        const siteIndex = state.allSites.findIndex(site => site.id === siteId)
        if (siteIndex >= 0) {
          // Replace the entire site object to ensure all fields are updated
          state.allSites[siteIndex] = {
            ...state.allSites[siteIndex],
            ...updates
          }
          // Re-sort after updating (creates new array for React reactivity)
          state.allSites = sortSites(state.allSites)
        }
      })
    },

    // Computed getters
    getRunningSites: () => {
      return get().allSites.filter(site => site.status === SiteStatus.Running)
    },

    getTotalSites: () => {
      return get().allSites.length
    },

    getRunningCount: () => {
      return get().allSites.filter(site => site.status === SiteStatus.Running).length
    },

    // Clear error state
    clearError: () => {
      set((state) => {
        state.error = null
      })
    },

    // Clear requiresAuth flag (call after successful re-authentication to allow refetch)
    clearRequiresAuth: () => {
      set((state) => {
        state.requiresAuth = false
      })
    },

    // Cleanup store state
    cleanup: () => {
      set((state) => {
        state.allSites = []
        state.sitesById = {}
        state.isLoadingAll = false
        state.loadingById = {}
        state.error = null
        state.lastFetchedAll = null
        state.requiresAuth = false
      })
    }
  }))
)

// Helper hook to get all sites data (replaces useSites hook)
export const useSites = (options?: { enabled?: boolean }) => {
  const allSites = useSitesStore((state) => state.allSites)
  const isLoadingAll = useSitesStore((state) => state.isLoadingAll)
  const error = useSitesStore((state) => state.error)
  const requiresAuth = useSitesStore((state) => state.requiresAuth)
  const fetchAllSites = useSitesStore((state) => state.fetchAllSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)
  const deleteSite = useSitesStore((state) => state.deleteSite)
  const stopAllSites = useSitesStore((state) => state.stopAllSites)
  const deleteAllSites = useSitesStore((state) => state.deleteAllSites)
  const getRunningSites = useSitesStore((state) => state.getRunningSites)
  const getTotalSites = useSitesStore((state) => state.getTotalSites)
  const getRunningCount = useSitesStore((state) => state.getRunningCount)
  const lastFetchedAll = useSitesStore((state) => state.lastFetchedAll)

  const enabled = options?.enabled ?? true

  // Auto-fetch sites on first use (if never fetched and not loading and enabled)
  // Skip if requiresAuth is true to avoid 401 retry loop - user must re-authenticate first
  React.useEffect(() => {
    if (enabled && !lastFetchedAll && !isLoadingAll && !requiresAuth) {
      fetchAllSites()
    }
  }, [enabled, lastFetchedAll, isLoadingAll, requiresAuth, fetchAllSites])

  return {
    // Data
    sites: allSites,
    isLoading: isLoadingAll,
    error,
    /** True when sites list is empty because user needs to authenticate */
    requiresAuth,

    // Actions
    refreshSites,
    deleteSite,
    stopAllSites,
    deleteAllSites,

    // Computed values
    runningSites: getRunningSites(),
    totalSites: getTotalSites(),
    runningCount: getRunningCount()
  }
}

// Helper hook to get individual site data (replaces useSite hook)
export const useSite = (siteId: string | null) => {
  const sitesById = useSitesStore((state) => state.sitesById)
  const loadingById = useSitesStore((state) => state.loadingById)
  const error = useSitesStore((state) => state.error)
  const fetchSite = useSitesStore((state) => state.fetchSite)

  const site = siteId ? sitesById[siteId] : null
  const isLoading = siteId ? loadingById[siteId] || false : false

  // Auto-fetch site data when siteId changes
  React.useEffect(() => {
    if (siteId && !site && !isLoading) {
      fetchSite(siteId)
    }
  }, [siteId, site, isLoading, fetchSite])

  return {
    site,
    isLoading,
    error,
    refetch: siteId ? () => fetchSite(siteId) : null
  }
}
