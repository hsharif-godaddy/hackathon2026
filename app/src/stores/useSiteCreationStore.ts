import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { agentFetch } from '@/lib/agent-fetch'
import { SiteStatus } from '@/lib/control-plane/types'
import { appFetch } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useSiteStore } from './useSiteStore'

export interface Site {
  id: string
  name?: string
  status: SiteStatus
  agent_url?: string
  backend_url?: string
  preview_url?: string
  account_id: string
  initial_prompt?: string
  system_id?: string // V2 only: systemId from mgmt-hosting
  subscription_id?: string // V2 only: subscriptionId from mgmt-hosting
  created_at: Date
  updated_at: Date
}

export type SiteCreationPhase =
  | 'initializing'
  | 'deploying'
  | 'polling'
  | 'verifying-agent'
  | 'complete'
  | 'error'

interface SiteCreationStore {
  // Core state
  siteId: string | null      // Initial ID (job ID during provisioning, permanent ID once resolved)
  realAppId: string | null   // Final app ID after job completion (null while still a job ID)
  site: Site | null

  // Flow state
  phase: SiteCreationPhase
  isPolling: boolean

  // Error handling
  error: string | null
  retryCount: number

  // Polling management
  pollingInterval: NodeJS.Timeout | null
  lastPollTime: number | null
  maxRetries: number
  pollingIntervalMs: number

  // Actions
  initializeSite: (siteId: string) => Promise<void>
  startDeployment: () => Promise<void>
  cleanup: () => void
  retry: () => Promise<void>
  reset: () => void

  // Internal actions (not exposed to components)
  _pollSiteStatus: () => Promise<void>
  _startPolling: () => void
  _stopPolling: () => void
  _verifyAgentEndpoint: (agentUrl: string, appId: string, initialPrompt?: string) => Promise<boolean>
}

export const useSiteCreationStore = create<SiteCreationStore>()(
  devtools(
    immer((set, get) => ({
    // Initial state
    siteId: null,
    realAppId: null,  // Will be set when we get the real app ID from API
    site: null,
    phase: 'initializing',
    isPolling: false,
    error: null,
    retryCount: 0,
    pollingInterval: null,
    lastPollTime: null,
    maxRetries: 3,
    pollingIntervalMs: 5000, // 5 seconds

    // Initialize site creation flow
    initializeSite: async (siteId: string) => {
      logger.info('site.creation.begin', { message: 'Initializing site creation', siteId })

      // Clean up any previous state first
      get()._stopPolling()

      // Clear the site cache to prevent stale IDs from previous creations
      try {
        useSiteStore.getState().cleanup()
      } catch (err) {
        logger.error('site.creation.cache-clear-failed', { appId: get().siteId ?? undefined, message: 'Failed to clear site cache', error: err })
      }

      set((state) => {
        // Reset ALL state to initial values (prevents UI showing old app IDs)
        state.siteId = siteId
        state.realAppId = null
        state.site = null
        state.phase = 'initializing'
        state.isPolling = false
        state.error = null
        state.retryCount = 0
        state.pollingInterval = null
        state.lastPollTime = null
        state.pollingIntervalMs = 5000
      })

      // Start deployment immediately
      await get().startDeployment()
    },

    // Start deployment
    startDeployment: async () => {
      const { siteId, phase } = get()
      if (!siteId) {
        set((state) => {
          state.error = 'No site ID provided'
          state.phase = 'error'
        })
        return
      }

      // Prevent multiple concurrent deployment attempts
      if (phase === 'deploying') return

      try {
        
        // First check if site exists and determine control plane type using centralized store
        const siteStore = useSiteStore.getState()
        const siteData = await siteStore.fetchSite(siteId)
        if (siteData) {
          
          // V2 apps deploy automatically - never call deploy endpoint
          const isV2 = !!siteData.system_id
          
          if (isV2) {
            set((state) => {
              state.phase = 'polling'
              state.error = null
            })
            get()._startPolling()
            return
          }

          // Quick-create starts deployment in the background and returns a job ID.
          // Treat "creating" as already in progress so we don't trigger a second deploy.
          if (
            siteData.status === SiteStatus.Running ||
            siteData.status === SiteStatus.Created ||
            siteData.status === SiteStatus.Creating
          ) {
            set((state) => {
              state.phase = 'polling'
              state.error = null
            })
            get()._startPolling()
            return
          }
        }
        
        // Site needs deployment - proceed
        set((state) => {
          state.phase = 'deploying'
          state.error = null
        })

        const deployResponse = await appFetch(`/api/sites/${siteId}/deploy`, {
          method: 'POST'
        })

        if (!deployResponse.ok) {
          const errorData = await deployResponse.json().catch(() => ({}))
          
          // Handle 409 Conflict (deployment already in progress) gracefully
          if (deployResponse.status === 409) {
            set((state) => {
              state.phase = 'polling'
              state.error = null // Clear any error since this is expected
            })
            get()._startPolling()
            return
          }
          
          // Handle 429 Rate Limit with retry
          if (deployResponse.status === 429) {
            const { retryCount, maxRetries } = get()
            if (retryCount < maxRetries) {
              const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 30000)
              logger.warn('site.deployment.rate_limited', {
                message: 'Rate limited, retrying after backoff',
                siteId,
                retryCount: retryCount + 1,
                maxRetries,
                backoffMs
              })
              
              set((state) => {
                state.retryCount = retryCount + 1
              })
              // Wait and retry
              await new Promise(resolve => setTimeout(resolve, backoffMs))
              return get().startDeployment() // Recursive retry
            } else {
              throw new Error('Rate limited - please try again later')
            }
          }
          
          throw new Error(errorData.error || 'Failed to start deployment')
        }
        
        // Reset retry count on success
        set((state) => {
          state.retryCount = 0
        })

        await deployResponse.json()

        // Move to polling phase
        set((state) => {
          state.phase = 'polling'
        })

        // Start polling for completion
        get()._startPolling()

      } catch (error) {
        logger.error('site.deployment.failure', { appId: get().siteId ?? undefined, message: 'Error starting deployment', error: error instanceof Error ? error.message : 'Unknown error' })
        set((state) => {
          state.error = error instanceof Error ? error.message : 'Failed to start deployment'
          state.phase = 'error'
        })
      }
    },

    // Start polling
    _startPolling: () => {
      const { pollingInterval } = get()

      // Don't start if already polling
      if (pollingInterval) return

      set((state) => {
        state.isPolling = true
      })

      // Initial poll
      get()._pollSiteStatus()

      // Set up interval polling
      const interval = setInterval(() => {
        get()._pollSiteStatus()
      }, get().pollingIntervalMs)

      set((state) => {
        state.pollingInterval = interval
      })
    },

    // Stop polling
    _stopPolling: () => {
      const { pollingInterval } = get()

      if (pollingInterval) {
        clearInterval(pollingInterval)
        set((state) => {
          state.pollingInterval = null
          state.isPolling = false
        })
      }
    },

    // Poll site status
    _pollSiteStatus: async () => {
      const { siteId, phase } = get()

      if (!siteId || phase !== 'polling') return

      try {

        // Use centralized site store to prevent duplicate requests
        // Force refresh to get latest status (bypass cache during polling)
        const siteStore = useSiteStore.getState()
        const siteData = await siteStore.fetchSite(siteId, true)
        
        if (!siteData) {
          throw new Error('Failed to get site status')
        }
        
        // Reset retry count on successful response
        set((state) => {
          state.retryCount = 0
          state.pollingIntervalMs = 5000 // Reset to default
        })

        // Also run health checks and auto-status updates via SitePollingService
        // Use siteData.id (real appId) instead of siteId (might be jobId)
        // This also handles agent registration if the agent is healthy
        const { sitePollingService } = await import('@/services/SitePollingService')
        const siteStatus = await sitePollingService.checkSiteStatus(siteData.id)

        // Use the potentially updated status from health check service
        // Create a new object instead of mutating to avoid "read-only property" errors
        let finalSiteData = siteData
        if (siteStatus.status !== siteData.status) {
          finalSiteData = { ...siteData, status: siteStatus.status }
        }

        // Update site data and siteId (important for V2 where jobId transitions to appId)
        const previousSiteId = get().siteId
        const newSiteId = finalSiteData.id

        set((state) => {
          // Store both the original siteId and the real app ID
          // This preserves the original job ID but also gives us access to the real app ID
          if (previousSiteId !== newSiteId) {
            // We've detected a job ID → app ID transition
            // Keep original siteId but also store the real app ID
            state.realAppId = newSiteId

            // Funnel event: Job ID resolved to real app ID - critical for correlation
            shipAnalyticsLog('job_to_app.resolved', {
              jobId: previousSiteId,
              appId: newSiteId,
              status: finalSiteData.status,
            })
          } else {
            // No transition detected, update siteId normally
            state.siteId = newSiteId
          }

          state.site = finalSiteData
          state.lastPollTime = Date.now()
        })

        // Check if this is still a job ID - if so, don't mark as complete yet
        // Job IDs are 7 chars, V2 app IDs are 10 chars
        // CRITICAL: Check the ACTUAL site data ID, not the store's siteId which might be stale
        const isJobId = finalSiteData.id.length <= 8
        
        // Check if site is fully ready - wait for registration to complete before marking as done
        // CRITICAL: All conditions must be met:
        // 1. Status is 'running' (app is active)
        // 2. Has agent_url and preview_url (URLs are available)
        // 3. Services are healthy (siteStatus.ready)
        // 4. Registration succeeded (siteStatus.registrationComplete)
        // 5. We have a real app ID, not a job ID (!isJobId)
        if (finalSiteData.status === SiteStatus.Running && finalSiteData.agent_url && finalSiteData.preview_url &&
            siteStatus.ready && siteStatus.registrationComplete && !isJobId) {
          // Stop polling and mark as complete
          get()._stopPolling()
          set((state) => {
            state.phase = 'complete'
          })
        }
        
        // Check if agent is ready (has agent_url and status is 'running' or 'creating')
        // Apps can have agent URLs even in 'creating' status during provisioning.
        // IMPORTANT: Don't stop polling for job IDs even if they have URLs - wait for real app ID
        if (
          (finalSiteData.status === SiteStatus.Running || finalSiteData.status === SiteStatus.Creating) &&
          finalSiteData.agent_url &&
          !isJobId
        ) {
          get()._stopPolling()
          set((state) => {
            state.phase = 'verifying-agent'
          })

          // Verify the agent endpoint is actually working
          // Pass finalSiteData.id explicitly to ensure we use the real app ID, not a stale job ID from store
          // Also pass initial_prompt so we can suggest name and register during verification
          const isAgentReady = await get()._verifyAgentEndpoint(
            finalSiteData.agent_url,
            finalSiteData.id,
            finalSiteData.initial_prompt
          )

          if (isAgentReady) {
            set((state) => {
              state.phase = 'complete'
            })
          } else {
            // Agent not ready yet, wait longer before retrying (likely still registering)
            set((state) => {
              state.phase = 'polling'
            })

            // Wait 10 seconds before resuming polling to give agents service time to register
            setTimeout(() => {
              get()._startPolling()
            }, 10000)
          }
        } else if (finalSiteData.status === SiteStatus.Failed) {
          get()._stopPolling()
          set((state) => {
            state.error = 'Site deployment failed'
            state.phase = 'error'
          })
        }

      } catch (error) {
        logger.error('site.polling.failure', { appId: get().siteId ?? undefined, message: 'Error polling for site status', error: error instanceof Error ? error.message : 'Unknown error' })
        get()._stopPolling()
        set((state) => {
          state.error = error instanceof Error ? error.message : 'Failed to check site status'
          state.phase = 'error'
        })
      }
    },

    // Verify agent endpoint is ready and optionally suggest name
    _verifyAgentEndpoint: async (agentUrl: string, appId: string, initialPrompt?: string): Promise<boolean> => {
      try {
        if (!appId) {
          logger.error('site.verification.no_app_id', { message: 'No appId provided for agent verification' })
          return false
        }

        await appService.ensureAppRegistered(appId)

        // Step 1: Call ensure-running endpoint (app-specific)
        const endpointUrl = `${agentUrl}/apps/${appId}/ensure-running`

        const response = await agentFetch(endpointUrl, {
          siteId: appId,
          method: 'POST',
          signal: AbortSignal.timeout(15000) // 15 second timeout (same as integration test)
        })

        if (!response.ok) {
          return false
        }

        // Step 2: If initial prompt exists, call AppService to suggest name and register
        if (initialPrompt) {
          try {
            await appService.updateNameAndRegister(appId)
            // Update local store with the new name from site store
            const updatedSite = useSiteStore.getState().sites[appId]

            if (updatedSite?.name) {
              set((state) => {
                if (state.site && state.site.id === appId) {
                  state.site.name = updatedSite.name
                }
              })
            }
          } catch {
            // Don't fail verification if name suggestion fails - it's optional
          }
        }

        return true

      } catch (error) {
        logger.warn('site.verification.error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        return false
      }
    },

    // Retry the entire flow
    retry: async () => {
      const { siteId, retryCount, maxRetries } = get()

      if (retryCount >= maxRetries) {
        set((state) => {
          state.error = `Maximum retries (${maxRetries}) reached`
          state.phase = 'error'
        })
        return
      }

      get()._stopPolling()

      set((state) => {
        state.retryCount = retryCount + 1
        state.error = null
        state.phase = 'deploying'
      })

      if (siteId) {
        await get().startDeployment()
      }
    },

    // Clean up resources
    cleanup: () => {
      get()._stopPolling()
    },

    // Reset store to initial state
    reset: () => {
      get()._stopPolling()

      set((state) => {
        state.siteId = null
        state.realAppId = null  // Clear the real app ID
        state.site = null
        state.phase = 'initializing'
        state.isPolling = false
        state.error = null
        state.retryCount = 0
        state.pollingInterval = null
        state.lastPollTime = null
      })
    }
  })),
    { name: 'SiteCreationStore' }
  )
)

// Cleanup function for use in components
export const cleanupSiteCreationStore = () => {
  useSiteCreationStore.getState().cleanup()
}
