import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appFetch } from '@/lib/gasket-config'

export interface Site {
  id: string
  name?: string
  status: 'pending' | 'queued' | 'running' | 'failed' | 'stopped'
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
  _updateSiteName: () => Promise<void>
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
    pollingIntervalMs: 3000, // 3 seconds
    
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
        
        // Get site status
        const siteResponse = await appFetch(`/api/sites/${siteId}`)
        if (!siteResponse.ok) {
          throw new Error('Failed to get site status')
        }
        
        const siteData: Site = await siteResponse.json()
        
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
            await get()._updateSiteName()
          } else {
            // Agent not ready yet, go back to polling
            console.log('⏳ Agent endpoint not ready yet, resuming polling...')
            set((state) => {
              state.phase = 'polling'
            })
            get()._startPolling()
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
        // The agentUrl already includes the full path, just add the endpoint
        console.log('🔍 Original agent URL:', agentUrl)
        const endpointUrl = `${agentUrl}/ensure-running`
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
    _updateSiteName: async () => {
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
        
        // Call the agent to get a name suggestion
        console.log('🏷️ Calling suggest-name endpoint...')
        const agentResponse = await fetch(`http://localhost:4000/apps/suggest-name`, {
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