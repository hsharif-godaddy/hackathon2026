import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
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
  controlPlane?: 'v2' | 'legacy' // Control plane type (v2 or legacy)
  system_id?: string // V2 only: systemId from mgmt-hosting
  subscription_id?: string // V2 only: subscriptionId from mgmt-hosting
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
  siteId: string | null      // Initial ID (job ID in V2, permanent ID in legacy)
  realAppId: string | null   // Final app ID after V2 job completion (null in legacy mode)
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
  _verifyAgentEndpoint: (agentUrl: string, appId: string) => Promise<boolean>
  _updateSiteName: (agentUrl: string) => Promise<void>
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
      logger.info('site.creation.version_check', { message: 'Store version check - updated with debugging' })

      // Clean up any previous state first
      get()._stopPolling()
      
      // Clear the site cache to prevent stale IDs from previous creations
      const { useSiteStore } = await import('./useSiteStore')
      try {
        useSiteStore.getState().cleanup()
        logger.info('site.creation.cache-cleared', { message: 'Cleared site cache to prevent stale ID reuse' })
      } catch (err) {
        logger.error('site.creation.cache-clear-failed', { message: 'Failed to clear site cache', error: err })
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
      if (phase === 'deploying') {
        logger.info('site.deployment.duplicate', { message: 'Deployment already in progress, skipping duplicate request' })
        return
      }

      try {
        logger.info('site.deployment.start', { message: 'Checking site status before deployment', siteId })
        
        // First check if site exists and determine control plane type using centralized store
        const { useSiteStore } = await import('./useSiteStore')
        const siteStore = useSiteStore.getState()
        const siteData = await siteStore.fetchSite(siteId)
        if (siteData) {
          
          // V2 apps deploy automatically - never call deploy endpoint
          // Check if this is V2 by looking for controlPlane field or system_id
          const isV2 = siteData.controlPlane === 'v2' || siteData.system_id
          
          if (isV2) {
            logger.info('site.deployment.v2-skip', { 
              message: 'V2 app detected - apps deploy automatically, skipping deploy and starting polling', 
              siteId,
              status: siteData.status,
              controlPlane: siteData.controlPlane,
              hasSystemId: !!siteData.system_id
            })
            
            set((state) => {
              state.phase = 'polling'
              state.error = null
            })
            
            get()._startPolling()
            return
          }
          
          // Legacy: If already running/created, skip re-deploy
          if (siteData.status === 'running' || siteData.status === 'created') {
            logger.info('site.deployment.legacy-skip', { 
              message: 'Legacy site already active - skipping re-deploy and starting polling', 
              siteId,
              status: siteData.status
            })
            
            set((state) => {
              state.phase = 'polling'
              state.error = null
            })
            
            get()._startPolling()
            return
          }
        }
        
        // Legacy site needs deployment - proceed
        logger.info('site.deployment.trigger', { message: 'Triggering deployment for legacy site', siteId })
        
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

        // Use centralized site store to prevent duplicate requests
        // Force refresh to get latest status (bypass cache during polling)
        const { useSiteStore } = await import('./useSiteStore')
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
          logger.info('site.polling.status_update', {
            message: 'Status updated by health check',
            original: siteData.status,
            updated: siteStatus.status
          })
          finalSiteData = { ...siteData, status: siteStatus.status }
        }

        // Update site data and siteId (important for V2 where jobId transitions to appId)
        const previousSiteId = get().siteId
        const newSiteId = finalSiteData.id
        
        if (previousSiteId !== newSiteId) {
          logger.info('site.polling.id_transition', {
            message: 'Site ID changed (V2: jobId → appId)',
            previousId: previousSiteId,
            newId: newSiteId
          })
        }

        set((state) => {
          // Store both the original siteId and the real app ID
          // This preserves the original job ID but also gives us access to the real app ID
          if (previousSiteId !== newSiteId) {
            // We've detected a job ID → app ID transition
            // Keep original siteId but also store the real app ID
            state.realAppId = newSiteId
            logger.info('site.polling.storing_real_app_id', {
              message: 'Storing real app ID for redirect',
              originalId: state.siteId,
              realAppId: newSiteId
            })
          } else {
            // No transition detected, update siteId normally
            state.siteId = newSiteId
          }
          
          state.site = finalSiteData
          state.lastPollTime = Date.now()
        })

        logger.info('site.polling.result', {
          message: 'Site status poll result',
          siteId: finalSiteData.id,
          status: finalSiteData.status,
          hasAgentUrl: !!finalSiteData.agent_url,
          agentUrl: finalSiteData.agent_url,
          backendUrl: finalSiteData.backend_url,
          previewUrl: finalSiteData.preview_url,
          createdAt: finalSiteData.created_at,
          updatedAt: finalSiteData.updated_at
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
        if (finalSiteData.status === 'running' && finalSiteData.agent_url && finalSiteData.preview_url && 
            siteStatus.ready && siteStatus.registrationComplete && !isJobId) {
          logger.info('site.ready.v2-running', {
            message: 'V2 site is running with all URLs, registration complete, and has real app ID',
            status: finalSiteData.status,
            hasAgentUrl: !!finalSiteData.agent_url,
            hasPreviewUrl: !!finalSiteData.preview_url,
            servicesReady: siteStatus.ready,
            registrationComplete: siteStatus.registrationComplete,
            isRealAppId: !isJobId,
            siteId: finalSiteData.id,
            siteIdLength: finalSiteData.id.length
          })
          
          // Stop polling and mark as complete
          get()._stopPolling()
          set((state) => {
            state.phase = 'complete'
          })
          
          logger.info('site.creation.complete', {
            message: 'Site creation complete - ready for redirect',
            siteId: finalSiteData.id,
            status: finalSiteData.status
          })
        } else if (finalSiteData.status === 'running' && finalSiteData.agent_url && finalSiteData.preview_url) {
          // Log why we're not marking complete (for debugging)
          const reasons = [];
          if (isJobId) reasons.push('Still on job ID (length <= 8), waiting for real app ID');
          if (!siteStatus.ready) reasons.push('Services not all healthy yet');
          if (!siteStatus.registrationComplete) {
            if (siteStatus.registrationAttempted) {
              reasons.push('Registration failed - will retry on next poll');
            } else {
              reasons.push('Registration not yet attempted');
            }
          }
          
          logger.info('site.ready.waiting', {
            message: 'Site appears ready but waiting for conditions',
            siteId: finalSiteData.id,
            status: finalSiteData.status,
            isJobId,
            siteIdLength: finalSiteData.id.length,
            servicesReady: siteStatus.ready,
            registrationComplete: siteStatus.registrationComplete,
            registrationAttempted: siteStatus.registrationAttempted,
            reasons
          })
        }
        
        // Check if agent is ready (has agent_url and status is 'running' or 'creating')
        // V2 apps can have agent URLs even in 'creating' status, which differs from legacy behavior.
        // For legacy apps, agent_url is only present when status is 'running'.
        // IMPORTANT: Don't stop polling for job IDs even if they have URLs - wait for real app ID
        if ((finalSiteData.status === 'running' || finalSiteData.status === 'creating') && finalSiteData.agent_url && !isJobId) {
          logger.info('site.verification.begin', {
            message: `Site has agent URL! Verifying agent endpoint. Accepting 'creating' status for V2 apps (legacy apps only provide agent_url in 'running' status).`,
            status: finalSiteData.status,
            controlPlane: process.env.USE_V2_CONTROL_PLANE === 'true' ? 'V2' : 'Legacy'
          })
          logger.info('site.verification.url', { message: 'Agent URL to verify', url: finalSiteData.agent_url })

          get()._stopPolling()
          set((state) => {
            state.phase = 'verifying-agent'
          })

          // Verify the agent endpoint is actually working
          // Pass finalSiteData.id explicitly to ensure we use the real app ID, not a stale job ID from store
          const isAgentReady = await get()._verifyAgentEndpoint(finalSiteData.agent_url, finalSiteData.id)
          logger.info('site.verification.result', { message: 'Agent verification result', success: isAgentReady })

          if (isAgentReady) {
            logger.info('site.verification.success', { message: 'Agent endpoint verified! Starting name update' })
            await get()._updateSiteName(finalSiteData.agent_url)
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
        } else if (finalSiteData.status === 'failed') {
          get()._stopPolling()
          set((state) => {
            state.error = 'Site deployment failed'
            state.phase = 'error'
          })
        }
        // Continue polling if still pending/queued
        logger.info('site.polling.continue', { 
          message: 'Polling cycle complete - continuing to poll', 
          siteId: finalSiteData.id,
          status: finalSiteData.status,
          phase: get().phase,
          isPolling: get().isPolling,
          hasPollingInterval: !!get().pollingInterval
        })

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
    // appId is passed explicitly to ensure we use the correct ID (not a stale job ID from store)
    _verifyAgentEndpoint: async (agentUrl: string, appId: string): Promise<boolean> => {
      try {
        if (!appId) {
          logger.error('site.verification.no_app_id', { message: 'No appId provided for agent verification' })
          return false
        }

        logger.info('site.verification.start', { 
          message: 'Verifying agent endpoint',
          agentUrl,
          appId,
          appIdLength: appId.length
        })

        const endpointUrl = `${agentUrl}/apps/${appId}/ensure-running`
        logger.info('site.verification.endpoint_url', { message: 'Constructed endpoint URL', url: endpointUrl })

        const response = await agentFetch(endpointUrl, {
          siteId: appId,
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
      const { siteId, realAppId, site } = get()
      if (!siteId || !site) {
        logger.warn('site.name_update.no_data', { message: 'No siteId or site data for name update' })
        return
      }
      
      // Use real app ID if available (important for V2 where siteId might be a job ID)
      const effectiveId = realAppId || site.id || siteId
      logger.info('site.name_update.using_id', { 
        siteId, 
        realAppId, 
        effectiveId,
        message: 'Using effective ID for name update'
      })
      
      // Safety check: If we don't have a real app ID yet, skip name update
      // This can happen if the site is still provisioning
      if (!site.id || site.id.length < 8) {
        logger.warn('site.name_update.skipped', { 
          message: 'Site ID not ready yet, skipping name update',
          siteId: site.id
        })
        set((state) => {
          state.phase = 'complete'
        })
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
          siteId,
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

            // Update the site name using the effective ID (real app ID, not job ID)
            const updateResponse = await appFetch(`/api/sites/${effectiveId}`, {
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
              
              // Update the global site store cache to reflect the name change in the UI
              const { useSiteStore } = await import('@/stores/useSiteStore')
              useSiteStore.getState().updateSite(effectiveId, { name: suggestedName })
              logger.info('site.name_update.cache_updated', { message: 'Updated site cache with new name', siteId: effectiveId })
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
        
        logger.info('site.creation.name-update-flow-complete', { 
          message: 'Name update flow complete - page will handle cleanup on redirect'
        })

      } catch (error) {
        logger.error('site.name_update.error', { message: 'Error in name update flow', error: error instanceof Error ? error.message : 'Unknown error' })
        // Don't fail the entire flow for name update issues
        logger.warn('site.name_update.continue', { message: 'Name update failed, marking as complete anyway' })
        set((state) => {
          state.phase = 'complete'
        })
        
        logger.info('site.creation.name-update-error-complete', {
          message: 'Name update error handled - page will handle cleanup on redirect'
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
