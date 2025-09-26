import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { appService, type App, type AppStatusData, type CreateAppData } from '@/services/AppService'
import { logger } from '@/lib/request-context'

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
        logger.error('app-store.polling.failure', { message: 'Error polling app status', error: error instanceof Error ? error.message : 'Unknown error occurred' })
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
        logger.info('app-store.ensure-running.begin', { message: 'Ensuring app is running', appId })
        
        const data = await appService.ensureAppIsRunning(appId)
        logger.info('app-store.ensure-running.response', { message: 'App ensure-running response', data })
        
        if (data.success) {
          logger.info('app-store.ensure-running.success', { message: 'App is now running', appMessage: data.message })
        }
        
        return data
      } catch (error) {
        logger.error('app-store.ensure-running.failure', { message: 'Error ensuring app is running', error: error instanceof Error ? error.message : 'Unknown error' })
        throw error
      }
    },
    
    // Restart app with retry logic
    restartApp: async (appId: string) => {
      const maxRetries = 2
      let lastError: Error | null = null
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.info('app-store.restart.attempt', { message: 'Restart attempt for app', attempt, maxRetries, appId })
          await appService.restartApp(appId)
          logger.info('app-store.restart.success', { message: 'App restarted successfully' })
          return
        } catch (error) {
          lastError = error as Error
          logger.error('app-store.restart.attempt-failed', { message: 'Restart attempt failed', attempt, maxRetries, error: error instanceof Error ? error.message : 'Unknown error' })
          
          if (attempt < maxRetries) {
            // Wait before retry, with exponential backoff
            const waitTime = attempt * 2000 // 2s, 4s
            logger.info('app-store.restart.retry-wait', { message: 'Waiting before retry', waitTime })
            await new Promise(resolve => setTimeout(resolve, waitTime))
          }
        }
      }
      
      logger.error('app-store.restart.all-attempts-failed', { message: 'All restart attempts failed for app', appId })
      throw lastError || new Error('Restart failed after multiple attempts')
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
              logger.info('app-store.port-sync', { message: 'Auto-syncing port', appId: app.id, oldPort: app.port, newPort: runningServer.port })
              app.port = runningServer.port
            }
          })
        })
      } catch (error) {
        logger.error('app-store.port-sync.failure', { message: 'Failed to sync actual ports', error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }
  }))
)

// Cleanup on unmount - call this in useEffect cleanup
export const cleanupAppStore = () => {
  useAppStore.getState().stopPolling()
}