import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appService, type App, type AppStatusData, type CreateAppData } from '@/services/AppService'

export enum AppStatus {
  CREATING = 'creating',
  CREATED = 'created',
  ERROR = 'error',
  RUNNING = 'running',
  STOPPED = 'stopped'
}

export type AppStatusType = `${AppStatus}`

interface AppStore {
  // App creation state
  currentApp: AppStatusData | null
  creationError: string | null
  isCreating: boolean
  
  // All apps state
  apps: App[]
  isLoadingApps: boolean
  appsError: string | null
  
  // Polling state
  pollingId: string | null
  pollingInterval: NodeJS.Timeout | null
  
  // Actions
  createApp: (data: CreateAppData) => Promise<string | null>
  startPolling: (appId: string) => void
  stopPolling: () => void
  pollAppStatus: (appId: string) => Promise<void>
  loadApps: () => Promise<void>
  clearCreationState: () => void
  ensureAppIsRunning: (appId: string) => Promise<{ success: boolean; action?: string; message?: string }>
  restartApp: (appId: string) => Promise<void>
  syncActualPorts: () => Promise<void>
  
  // Getters
  isAppReady: () => boolean
  shouldRedirect: () => boolean
}

export const useAppStore = create<AppStore>()(
  immer((set, get) => ({
    // Initial state
    currentApp: null,
    creationError: null,
    isCreating: false,
    apps: [],
    isLoadingApps: false,
    appsError: null,
    pollingId: null,
    pollingInterval: null,
    
    // Create a new app
    createApp: async (data: CreateAppData) => {
      set((state) => {
        state.isCreating = true
        state.creationError = null
        state.currentApp = null
      })
      
      try {
        const response = await appService.createApp(data)
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.message || `Failed to create app: ${response.status}`)
        }
        
        const { appId } = await response.json()
        
        set((state) => {
          state.pollingId = appId
        })
        
        // Start polling for status updates
        get().startPolling(appId)
        
        return appId
      } catch (error) {
        set((state) => {
          state.isCreating = false
          state.creationError = error instanceof Error ? error.message : 'Unknown error occurred'
        })
        return null
      }
    },
    
    // Start polling app status
    startPolling: (appId: string) => {
      // Clear any existing polling
      get().stopPolling()
      
      set((state) => {
        state.pollingId = appId
      })
      
      // Initial poll
      get().pollAppStatus(appId)
      
      // Set up interval polling
      const interval = setInterval(() => {
        get().pollAppStatus(appId)
      }, 2000)
      
      set((state) => {
        state.pollingInterval = interval
      })
    },
    
    // Stop polling
    stopPolling: () => {
      const { pollingInterval } = get()
      
      if (pollingInterval) {
        clearInterval(pollingInterval)
        set((state) => {
          state.pollingInterval = null
          state.pollingId = null
        })
      }
    },
    
    // Poll app status
    pollAppStatus: async (appId: string) => {
      try {
        const appStatus = await appService.getAppStatus(appId)
        
        set((state) => {
          state.currentApp = appStatus
          state.isCreating = appStatus.status === AppStatus.CREATING
        })
        
        // Stop polling if creation is complete or errored
        if (appStatus.status === AppStatus.CREATED || appStatus.status === AppStatus.ERROR) {
          get().stopPolling()
          
          if (appStatus.status === AppStatus.ERROR) {
            set((state) => {
              state.creationError = 'App creation failed. Please try again.'
            })
          }
        }
      } catch (error) {
        console.error('Error polling app status:', error)
        set((state) => {
          state.creationError = error instanceof Error ? error.message : 'Unknown error occurred'
          state.isCreating = false
        })
        get().stopPolling()
      }
    },
    
    // Load all apps
    loadApps: async () => {
      set((state) => {
        state.isLoadingApps = true
        state.appsError = null
      })
      
      try {
        const { apps } = await appService.getAllApps()
        set((state) => {
          state.apps = apps
          state.isLoadingApps = false
        })
        
        // Automatically sync actual ports after loading apps
        await get().syncActualPorts()
      } catch (error) {
        set((state) => {
          state.appsError = error instanceof Error ? error.message : 'Failed to load apps'
          state.isLoadingApps = false
        })
      }
    },
    
    // Clear creation state
    clearCreationState: () => {
      get().stopPolling()
      set((state) => {
        state.currentApp = null
        state.creationError = null
        state.isCreating = false
      })
    },
    
    // Getters
    isAppReady: () => {
      const { currentApp } = get()
      return currentApp?.status === AppStatus.CREATED
    },
    
    shouldRedirect: () => {
      const { currentApp, creationError } = get()
      return !creationError && currentApp?.status === AppStatus.CREATED
    },
    
    // Ensure app is running
    ensureAppIsRunning: async (appId: string) => {
      try {
        console.log('🔍 Ensuring app is running:', appId)
        
        const data = await appService.ensureAppIsRunning(appId)
        console.log('📊 App ensure-running response:', data)
        
        if (data.success) {
          console.log(`✅ App is now running: ${data.message}`)
        }
        
        return data
      } catch (error) {
        console.error('Error ensuring app is running:', error)
        throw error
      }
    },
    
    // Restart app
    restartApp: async (appId: string) => {
      try {
        await appService.restartApp(appId)
        console.log('✅ App restarted successfully')
      } catch (error) {
        console.error('❌ Failed to restart app:', error)
        throw error
      }
    },
    
    // Sync actual ports from running servers
    syncActualPorts: async () => {
      try {
        const serversData = await appService.getServers()
        const runningServers = serversData.servers || []
        
        set((state) => {
          // Update each app's port if it differs from actual running port
          state.apps.forEach(app => {
            const runningServer = runningServers.find(server => server.appId === app.id)
            if (runningServer && runningServer.port !== app.port) {
              console.log(`🔄 Auto-syncing port for ${app.id}: ${app.port} -> ${runningServer.port}`)
              app.port = runningServer.port
            }
          })
        })
      } catch (error) {
        console.error('Failed to sync actual ports:', error)
      }
    }
  }))
)

// Cleanup on unmount - call this in useEffect cleanup
export const cleanupAppStore = () => {
  useAppStore.getState().stopPolling()
}