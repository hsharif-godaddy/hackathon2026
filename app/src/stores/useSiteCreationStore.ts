import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appFetch } from '@/lib/gasket-config'

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
      console.log('🚀 [STORE] Initializing site creation for:', siteId)
      console.log('🚀 [STORE] Store version check - updated with debugging')

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
        console.log('⚠️ Deployment already in progress, skipping duplicate request')
        return
      }

      try {
        console.log('🚀 Starting deployment for site:', siteId)
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
            console.log('ℹ️ Deployment already in progress on server, switching to polling mode')
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
        console.log('✅ Deployment started:', deployData.message)

        // Move to polling phase
        set((state) => {
          state.phase = 'polling'
        })

        // Start polling for completion
        get()._startPolling()

      } catch (error) {
        console.error('❌ Error starting deployment:', error)
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

      console.log('🔄 Starting to poll for site status')
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
        console.log('🛑 Stopped polling for site status')

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
        console.log('🔄 [STORE] Polling site status for siteId:', siteId)

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
          console.log('🔄 [STORE] Status updated by health check:', {
            original: siteData.status,
            updated: siteStatus.status
          })
          siteData.status = siteStatus.status
        }

        set((state) => {
          state.site = siteData
          state.lastPollTime = Date.now()
        })

        console.log('📊 Site status poll result:', {
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
          console.log('✅ Site is running! Verifying agent endpoint...')
          console.log('🔍 Agent URL to verify:', siteData.agent_url)

          get()._stopPolling()
          set((state) => {
            state.phase = 'verifying-agent'
          })

          // Verify the agent endpoint is actually working
          const isAgentReady = await get()._verifyAgentEndpoint(siteData.agent_url)
          console.log('🔍 Agent verification result:', isAgentReady)

          if (isAgentReady) {
            console.log('✅ Agent endpoint verified! Starting name update...')
            await get()._updateSiteName(siteData.agent_url)
          } else {
            // Agent not ready yet, wait longer before retrying (likely still registering)
            console.log('⏳ Agent endpoint not ready yet, waiting 10 seconds before resuming polling...')
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
        console.error('❌ Error polling for site status:', error)
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
          console.error('❌ No siteId available for agent verification')
          return false
        }

        console.log('🔍 Original agent URL:', agentUrl)
        const endpointUrl = `${agentUrl}/apps/${siteId}/ensure-running`
        console.log('🔍 Constructed endpoint URL:', endpointUrl)

        const response = await fetch(endpointUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(15000) // 15 second timeout (same as integration test)
        })

        console.log('🔍 Agent endpoint response:', response.status, response.statusText)

        if (response.ok) {
          const data = await response.json()
          console.log('✅ Agent endpoint responded:', data)
          return true
        } else if (response.status === 404) {
          console.log('⚠️ Agent endpoint not found (404) - likely still registering with agents service')
          return false
        } else {
          console.log('⚠️ Agent endpoint returned non-OK status:', response.status, response.statusText)
          const errorText = await response.text().catch(() => 'Unable to read response')
          console.log('⚠️ Agent endpoint error response:', errorText)
          return false
        }
      } catch (error) {
        console.log('⚠️ Agent endpoint verification failed with error:', error)
        return false
      }
    },

    // Update site name using AI
    _updateSiteName: async (agentUrl: string) => {
      const { siteId, site } = get()
      if (!siteId || !site) {
        console.log('❌ No siteId or site data for name update')
        return
      }

      try {
        set((state) => {
          state.phase = 'updating-name'
        })

        console.log('🏷️ Starting name update from agent...')
        console.log('🏷️ Site data:', { siteId, initialPrompt: site.initial_prompt })

        // Get initial prompt from site
        const initialPrompt = site.initial_prompt || 'Suggest a name for this project'
        console.log('🏷️ Using prompt:', initialPrompt)

        // Call the agents service to get a name suggestion
        console.log('🏷️ Calling suggest-name endpoint...')
        const agentResponse = await appFetch(`${agentUrl}/apps/suggest-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: initialPrompt
          })
        })

        console.log('🏷️ Agent response status:', agentResponse.status, agentResponse.statusText)

        if (agentResponse.ok) {
          const nameData = await agentResponse.json()
          const suggestedName = nameData.name || nameData.suggestedName

          if (suggestedName) {
            console.log('🏷️ Got suggested name from agent:', suggestedName)

            // Update the site name
            const updateResponse = await appFetch(`/api/sites/${siteId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: suggestedName })
            })

            if (updateResponse.ok) {
              console.log('✅ Site name updated successfully')
              set((state) => {
                if (state.site) {
                  state.site.name = suggestedName
                }
              })
            } else {
              console.warn('⚠️ Failed to update site name, continuing anyway')
            }
          }
        } else {
          console.warn('⚠️ Failed to get name suggestion from agent, continuing anyway')
        }

        // Complete the flow
        set((state) => {
          state.phase = 'complete'
        })

      } catch (error) {
        console.error('❌ Error in name update flow:', error)
        // Don't fail the entire flow for name update issues
        console.log('⚠️ Name update failed, marking as complete anyway')
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

      console.log(`🔄 Retrying site creation (attempt ${retryCount + 1}/${maxRetries})`)

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
      console.log('🧹 Cleaning up site creation store')
      get()._stopPolling()
    },

    // Reset store to initial state
    reset: () => {
      console.log('🔄 Resetting site creation store')
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
