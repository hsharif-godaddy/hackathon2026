import React from 'react'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'
import { AppErrorCode } from '@/types/error-codes'

// Use SiteInfo from the existing interface for consistency
export type Site = SiteInfo

interface SitesStore {
  // State
  allSites: Site[]
  sitesById: Record<string, Site>
  isLoadingAll: boolean
  loadingById: Record<string, boolean>
  error: string | null
  lastFetchedAll: number | null

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

    // Fetch all sites from API
    fetchAllSites: async () => {
      const { isLoadingAll } = get()

      // Prevent duplicate requests
      if (isLoadingAll) return

      set((state) => {
        state.isLoadingAll = true
        state.error = null
      })

      try {
        const response = await appFetch('/api/sites')

        if (!response.ok) {
          throw new Error(`Failed to fetch sites: ${response.status} ${response.statusText}`)
        }

        const sitesData = await response.json()
        const sites = Array.isArray(sitesData) ? sitesData : []

        set((state) => {
          state.allSites = sites
          state.isLoadingAll = false
          state.lastFetchedAll = Date.now()

          // Update sitesById for consistency
          state.sitesById = {}
          sites.forEach(site => {
            state.sitesById[site.id] = site
          })
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
      const runningSites = allSites.filter(site => site.status === 'running')

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
            if (site.status === 'running') {
              site.status = 'stopped'
            }
          })

          // Update sitesById as well
          Object.values(state.sitesById).forEach(site => {
            if (site.status === 'running') {
              site.status = 'stopped'
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
          Object.assign(state.allSites[siteIndex], updates)
        }
      })
    },

    // Computed getters
    getRunningSites: () => {
      return get().allSites.filter(site => site.status === 'running')
    },

    getTotalSites: () => {
      return get().allSites.length
    },

    getRunningCount: () => {
      return get().allSites.filter(site => site.status === 'running').length
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
        state.allSites = []
        state.sitesById = {}
        state.isLoadingAll = false
        state.loadingById = {}
        state.error = null
        state.lastFetchedAll = null
      })
    }
  }))
)

// Helper hook to get all sites data (replaces useSites hook)
export const useSites = (options?: { enabled?: boolean }) => {
  const allSites = useSitesStore((state) => state.allSites)
  const isLoadingAll = useSitesStore((state) => state.isLoadingAll)
  const error = useSitesStore((state) => state.error)
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
  React.useEffect(() => {
    if (enabled && !lastFetchedAll && !isLoadingAll) {
      fetchAllSites()
    }
  }, [enabled, lastFetchedAll, isLoadingAll, fetchAllSites])

  return {
    // Data
    sites: allSites,
    isLoading: isLoadingAll,
    error,

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
