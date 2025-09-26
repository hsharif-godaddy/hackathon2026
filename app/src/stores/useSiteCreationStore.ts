import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appFetch } from '@/lib/gasket-config'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

export interface Site {
  id: string
  name?: string
  status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error'
  agent_url?: string
  backend_url?: string
  preview_url?: string
  account_id: string
  initial_prompt?: string
  created_at: string
  updated_at: string
}

export type SiteCreationPhase =
  | 'initializing'
  | 'deploying'
  | 'polling'
  | 'verifying-agent'
  | 'updating-name'
  | 'complete'
  | 'error'

interface SiteCreationStore {
  // Core state
  siteId: string | null
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
  _verifyAgentEndpoint: (agentUrl: string) => Promise<boolean>
  _updateSiteName: (agentUrl: string) => Promise<void>
}

export const useSiteCreationStore = create<SiteCreationStore>()(
  immer((set, get) => ({
    // Initial state
    siteId: null,
    site: null,
    phase: 'initializing',
    isPolling: false,
    error: null,
    retryCount: 0,
    pollingInterval: null,
    lastPollTime: null,
    maxRetries: 3,
    pollingIntervalMs: 5000, // 5 seconds (reduced frequency)

    // Initialize site creation flow
    initializeSite: async (siteId: string) => {
      logger.info('site.creation.begin', { message: 'Initializing site creation', siteId })
      logger.info('site.creation.version_check', { message: 'Store version check - updated with debugging' })

      set((state) => {
        state.siteId = siteId
        state.phase = 'initializing'
        state.error = null
        state.retryCount = 0
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
      if (phase === 'deploying') {
        logger.info('site.deployment.duplicate', { message: 'Deployment already in progress, skipping duplicate request' })
        return
      }

      try {
        logger.info('site.deployment.start', { message: 'Starting deployment for site', siteId })
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
            logger.info('site.deployment.already_in_progress', { message: 'Deployment already in progress on server, switching to polling mode' })
            set((state) => {
              state.phase = 'polling'
              state.error = null // Clear any error since this is expected
            })
            
            // Start polling for the existing deployment
            get()._startPolling()
            return
          }
          
          throw new Error(errorData.error || 'Failed to start deployment')
        }

        const deployData = await deployResponse.json()
        logger.info('site.deployment.success', { message: 'Deployment started', deployMessage: deployData.message })

        // Move to polling phase
        set((state) => {
          state.phase = 'polling'
        })

        // Start polling for completion
        get()._startPolling()

      } catch (error) {
        logger.error('site.deployment.failure', { message: 'Error starting deployment', error: error instanceof Error ? error.message : 'Unknown error' })
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

      logger.info('site.polling.start', { message: 'Starting to poll for site status' })
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
        logger.info('site.polling.stop', { message: 'Stopped polling for site status' })

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
        logger.info('site.polling.status', { message: 'Polling site status', siteId })

        // Get full site data from API
        const siteResponse = await appFetch(`/api/sites/${siteId}`)
        if (!siteResponse.ok) {
          throw new Error('Failed to get site status')
        }

        const siteData: Site = await siteResponse.json()

        // Also run health checks and auto-status updates via SitePollingService
        const { sitePollingService } = await import('@/services/SitePollingService')
        const siteStatus = await sitePollingService.checkSiteStatus(siteId)

        // Use the potentially updated status from health check service
        if (siteStatus.status !== siteData.status) {
          logger.info('site.polling.status_update', {
            message: 'Status updated by health check',
            original: siteData.status,
            updated: siteStatus.status
          })
          siteData.status = siteStatus.status
        }

        set((state) => {
          state.site = siteData
          state.lastPollTime = Date.now()
        })

        logger.info('site.polling.result', {
          message: 'Site status poll result',
          siteId: siteData.id,
          status: siteData.status,
          hasAgentUrl: !!siteData.agent_url,
          agentUrl: siteData.agent_url,
          backendUrl: siteData.backend_url,
          previewUrl: siteData.preview_url,
          createdAt: siteData.created_at,
          updatedAt: siteData.updated_at
        })

        // Check if agent is running (has agent_url and status is 'running')
        if (siteData.status === 'running' && siteData.agent_url) {
          logger.info('site.verification.begin', { message: 'Site is running! Verifying agent endpoint' })
          logger.info('site.verification.url', { message: 'Agent URL to verify', url: siteData.agent_url })

          get()._stopPolling()
          set((state) => {
            state.phase = 'verifying-agent'
          })

          // Verify the agent endpoint is actually working
          const isAgentReady = await get()._verifyAgentEndpoint(siteData.agent_url)
          logger.info('site.verification.result', { message: 'Agent verification result', success: isAgentReady })

          if (isAgentReady) {
            logger.info('site.verification.success', { message: 'Agent endpoint verified! Starting name update' })
            await get()._updateSiteName(siteData.agent_url)
          } else {
            // Agent not ready yet, wait longer before retrying (likely still registering)
            logger.info('site.verification.not_ready', { message: 'Agent endpoint not ready yet, waiting 10 seconds before resuming polling' })
            set((state) => {
              state.phase = 'polling'
            })

            // Wait 10 seconds before resuming polling to give agents service time to register
            setTimeout(() => {
              get()._startPolling()
            }, 10000)
          }
        } else if (siteData.status === 'failed') {
          get()._stopPolling()
          set((state) => {
            state.error = 'Site deployment failed'
            state.phase = 'error'
          })
        }
        // Continue polling if still pending/queued

      } catch (error) {
        logger.error('site.polling.failure', { message: 'Error polling for site status', error: error instanceof Error ? error.message : 'Unknown error' })
        get()._stopPolling()
        set((state) => {
          state.error = error instanceof Error ? error.message : 'Failed to check site status'
          state.phase = 'error'
        })
      }
    },

    // Verify agent endpoint is ready
    _verifyAgentEndpoint: async (agentUrl: string): Promise<boolean> => {
      try {
        // Get siteId for the correct endpoint path
        const { siteId } = get()
        if (!siteId) {
          logger.error('site.verification.no_site_id', { message: 'No siteId available for agent verification' })
          return false
        }

        logger.info('site.verification.agent_url', { message: 'Original agent URL', url: agentUrl })
        const endpointUrl = `${agentUrl}/apps/${siteId}/ensure-running`
        logger.info('site.verification.endpoint_url', { message: 'Constructed endpoint URL', url: endpointUrl })

        const response = await agentFetch(endpointUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(15000) // 15 second timeout (same as integration test)
        })

        logger.info('site.verification.response', { message: 'Agent endpoint response', status: response.status, statusText: response.statusText })

        if (response.ok) {
          const data = await response.json()
          logger.info('site.verification.response_data', { message: 'Agent endpoint responded', data })
          return true
        } else if (response.status === 404) {
          logger.warn('site.verification.not_found', { message: 'Agent endpoint not found (404) - likely still registering with agents service' })
          return false
        } else {
          logger.warn('site.verification.non_ok_status', { message: 'Agent endpoint returned non-OK status', status: response.status, statusText: response.statusText })
          const errorText = await response.text().catch(() => 'Unable to read response')
          logger.warn('site.verification.error_response', { message: 'Agent endpoint error response', errorText })
          return false
        }
      } catch (error) {
        logger.warn('site.verification.error', { message: 'Agent endpoint verification failed with error', error: error instanceof Error ? error.message : 'Unknown error' })
        return false
      }
    },

    // Update site name using AI
    _updateSiteName: async (agentUrl: string) => {
      const { siteId, site } = get()
      if (!siteId || !site) {
        logger.warn('site.name_update.no_data', { message: 'No siteId or site data for name update' })
        return
      }

      try {
        set((state) => {
          state.phase = 'updating-name'
        })

        logger.info('site.name_update.begin', { message: 'Starting name update from agent' })
        logger.info('site.name_update.data', { message: 'Site data', siteId, initialPrompt: site.initial_prompt })

        // Get initial prompt from site
        const initialPrompt = site.initial_prompt || 'Suggest a name for this project'
        logger.info('site.name_update.prompt', { message: 'Using prompt', initialPrompt })

        // Call the agents service to get a name suggestion
        logger.info('site.name_update.api_call', { message: 'Calling suggest-name endpoint' })
        const agentResponse = await agentFetch(`${agentUrl}/apps/suggest-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: initialPrompt
          })
        })

        logger.info('site.name_update.api_response', { message: 'Agent response status', status: agentResponse.status, statusText: agentResponse.statusText })

        if (agentResponse.ok) {
          const nameData = await agentResponse.json()
          const suggestedName = nameData.name || nameData.suggestedName

          if (suggestedName) {
            logger.info('site.name_update.suggestion', { message: 'Got suggested name from agent', suggestedName })

            // Update the site name
            const updateResponse = await appFetch(`/api/sites/${siteId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: suggestedName })
            })

            if (updateResponse.ok) {
              logger.info('site.name_update.success', { message: 'Site name updated successfully', name: suggestedName })
              set((state) => {
                if (state.site) {
                  state.site.name = suggestedName
                }
              })
            } else {
              logger.warn('site.name_update.update_failure', { message: 'Failed to update site name, continuing anyway' })
            }
          }
        } else {
          logger.warn('site.name_update.suggestion_failure', { message: 'Failed to get name suggestion from agent, continuing anyway' })
        }

        // Complete the flow
        set((state) => {
          state.phase = 'complete'
        })

      } catch (error) {
        logger.error('site.name_update.error', { message: 'Error in name update flow', error: error instanceof Error ? error.message : 'Unknown error' })
        // Don't fail the entire flow for name update issues
        logger.warn('site.name_update.continue', { message: 'Name update failed, marking as complete anyway' })
        set((state) => {
          state.phase = 'complete'
        })
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

      logger.info('site.creation.retry', { message: `Retrying site creation`, attempt: retryCount + 1, maxRetries })

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
      logger.info('site.creation.cleanup', { message: 'Cleaning up site creation store' })
      get()._stopPolling()
    },

    // Reset store to initial state
    reset: () => {
      logger.info('site.creation.reset', { message: 'Resetting site creation store' })
      get()._stopPolling()

      set((state) => {
        state.siteId = null
        state.site = null
        state.phase = 'initializing'
        state.isPolling = false
        state.error = null
        state.retryCount = 0
        state.pollingInterval = null
        state.lastPollTime = null
      })
    }
  }))
)

// Cleanup function for use in components
export const cleanupSiteCreationStore = () => {
  useSiteCreationStore.getState().cleanup()
}
