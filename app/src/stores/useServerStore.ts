import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'
import { appService } from '@/services/AppService'

// Enable Immer MapSet plugin for Map/Set support
enableMapSet()

export enum ServerStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPED = 'stopped',
  ERROR = 'error',
  UNKNOWN = 'unknown'
}

export type ServerStatusType = `${ServerStatus}`

export interface ServerInfo {
  appId: string
  assignedPort?: number  // Port from database/app creation
  actualPort?: number    // Actual port server is running on
  status: ServerStatus
  isHealthy: boolean
  error?: string
  retryCount: number
  lastChecked?: Date
  lastHealthCheck?: Date
  intervalId?: NodeJS.Timeout  // For health monitoring interval
  consecutiveFailures: number  // Track consecutive health check failures
  lastBackendSync?: Date       // When we last verified with backend
  healthCheckInterval?: number // Current health check interval (for adaptive backoff)
}

interface ServerStore {
  // Server tracking state
  servers: Map<string, ServerInfo>
  revalidationTimeouts?: Map<string, NodeJS.Timeout>
  periodicSyncIntervalId?: NodeJS.Timeout
  
  // Health check configuration
  maxRetries: number
  healthCheckInterval: number
  retryBackoffMs: number
  
  // Actions - Server lifecycle
  registerServer: (appId: string, assignedPort?: number) => void
  updateServerPort: (appId: string, actualPort: number) => void
  updateServerStatus: (appId: string, status: ServerStatus, error?: string) => void
  
  // Actions - Health checking
  checkServerHealth: (appId: string) => Promise<boolean>
  waitForServerReady: (appId: string) => Promise<string | null>
  startHealthMonitoring: (appId: string, delayInitialCheck?: boolean) => void
  stopHealthMonitoring: (appId: string) => void
  
  // Actions - Retry mechanism
  retryConnection: (appId: string) => Promise<boolean>
  resetRetryCount: (appId: string) => void
  
  // Getters
  getServerInfo: (appId: string) => ServerInfo | undefined
  getServerUrl: (appId: string) => string | null
  isServerReady: (appId: string) => boolean
  
  // Backend validation
  revalidateWithBackend: (appId: string) => Promise<boolean>
  scheduleBackendRevalidation: (appId: string) => void
  startPeriodicBackendSync: () => void
  stopPeriodicBackendSync: () => void
  
  // Cleanup
  unregisterServer: (appId: string) => void
  cleanup: () => void
}

export const useServerStore = create<ServerStore>()(
  immer((set, get) => ({
    // Initial state
    servers: new Map(),
    revalidationTimeouts: new Map(),
    maxRetries: 10,
    healthCheckInterval: 3000,
    retryBackoffMs: 1000,
    
    // Server lifecycle actions
    registerServer: (appId: string, assignedPort?: number) => {
      set((state) => {
        state.servers.set(appId, {
          appId,
          assignedPort,
          actualPort: undefined, // Do NOT set actualPort until confirmed by backend
          status: ServerStatus.STARTING,
          isHealthy: false,
          retryCount: 0,
          lastChecked: new Date(),
          consecutiveFailures: 0,
          lastBackendSync: new Date(),
          healthCheckInterval: get().healthCheckInterval
        })
      })
    },
    
    updateServerPort: (appId: string, actualPort: number) => {
      set((state) => {
        const server = state.servers.get(appId)
        if (server) {
          server.actualPort = actualPort
          server.lastChecked = new Date()
        }
      })
    },
    
    updateServerStatus: (appId: string, status: ServerStatus, error?: string) => {
      set((state) => {
        const server = state.servers.get(appId)
        if (server) {
          server.status = status
          server.isHealthy = status === ServerStatus.RUNNING
          server.error = error
          server.lastChecked = new Date()
          
          if (status === ServerStatus.RUNNING) {
            server.retryCount = 0
          }
        }
      })
    },
    
    // Enhanced health checking with connection refused handling and adaptive intervals
    checkServerHealth: async (appId: string) => {
      const server = get().servers.get(appId)
      if (!server || !server.actualPort) {
        return false
      }
      
      const url = `http://localhost:${server.actualPort}`
      
      try {
        set((state) => {
          const srv = state.servers.get(appId)
          if (srv) {
            srv.lastHealthCheck = new Date()
          }
        })
        
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)
        
        const response = await fetch(url, {
          signal: controller.signal,
          method: 'GET' // Use GET to match iframe behavior and ensure document is ready
        })
        
        clearTimeout(timeoutId)
        
        const isHealthy = response.ok
        
        set((state) => {
          const srv = state.servers.get(appId)
          if (srv) {
            srv.isHealthy = isHealthy
            srv.status = isHealthy ? ServerStatus.RUNNING : ServerStatus.ERROR
            srv.error = isHealthy ? undefined : `Server returned ${response.status}: ${response.statusText}`
            srv.lastChecked = new Date()
            
            if (isHealthy) {
              // Reset consecutive failures and health check interval on success
              srv.consecutiveFailures = 0
              srv.healthCheckInterval = get().healthCheckInterval // Reset to default
            } else {
              srv.consecutiveFailures = (srv.consecutiveFailures || 0) + 1
            }
          }
        })
        
        return isHealthy
      } catch (error) {
        const isConnectionRefused = error instanceof Error && 
          (error.message.includes('fetch') || 
           error.message.includes('refused') || 
           error.message.includes('ECONNREFUSED') ||
           error.name === 'AbortError')
           
        console.log(`Health check failed for ${appId} (${isConnectionRefused ? 'connection refused' : 'other error'}):`, error instanceof Error ? error.message : error)
        
        set((state) => {
          const srv = state.servers.get(appId)
          if (srv) {
            srv.isHealthy = false
            srv.error = error instanceof Error ? error.message : 'Connection failed'
            srv.lastChecked = new Date()
            srv.consecutiveFailures = (srv.consecutiveFailures || 0) + 1
            
            // Handle connection refused errors more aggressively
            if (isConnectionRefused) {
              if (srv.consecutiveFailures >= 3) {
                // After 3+ consecutive connection refused errors, mark as STOPPED
                console.log(`🛑 Server ${appId} marked as STOPPED after ${srv.consecutiveFailures} connection refused errors`)
                srv.status = ServerStatus.STOPPED
                srv.actualPort = undefined // Clear stale port reference
                
                // Stop health monitoring for this server
                if (srv.intervalId) {
                  clearInterval(srv.intervalId)
                  srv.intervalId = undefined
                }
                
                // Schedule backend revalidation
                get().scheduleBackendRevalidation?.(appId)
              } else {
                srv.status = ServerStatus.ERROR
              }
            } else {
              // For other errors, just mark as ERROR
              srv.status = ServerStatus.ERROR
            }
            
            // Implement adaptive health check interval (exponential backoff)
            if (srv.consecutiveFailures >= 2) {
              const baseInterval = get().healthCheckInterval
              srv.healthCheckInterval = Math.min(
                baseInterval * Math.pow(2, srv.consecutiveFailures - 2),
                30000 // Cap at 30 seconds
              )
              console.log(`📉 Increased health check interval for ${appId} to ${srv.healthCheckInterval}ms after ${srv.consecutiveFailures} failures`)
            }
          }
        })
        
        return false
      }
    },
    
    waitForServerReady: async (appId: string) => {
      console.log(`⏳ Waiting for server to be ready for appId: ${appId}`)
      
      const maxAttempts = 60 // 60 attempts × 1 second = 1 minute timeout
      let attempts = 0
      
      while (attempts < maxAttempts) {
        try {
          // Use appService to poll the backend servers endpoint
          const data = await appService.getServers()
          const servers = data.servers || []
          
          // Look for our specific appId in the running servers
          const serverForApp = servers.find((server: { appId: string; port: number }) => server.appId === appId)
          
          console.log(`🔍 Attempt ${attempts + 1}: Searching for appId ${appId} in servers:`, {
            targetAppId: appId,
            foundServers: servers.map(s => ({ appId: s.appId, port: s.port })),
            foundMatch: !!serverForApp
          })
          
          if (serverForApp && serverForApp.port) {
            const serverUrl = `http://localhost:${serverForApp.port}`
            console.log(`✅ Found server for appId ${appId} on port ${serverForApp.port}`)
            
            // Update our store with the confirmed port
            set((state) => {
              const server = state.servers.get(appId)
              if (server) {
                server.actualPort = serverForApp.port
                server.status = ServerStatus.RUNNING
                server.isHealthy = true
                server.lastChecked = new Date()
              }
            })
            
            return serverUrl
          }
          
          console.log(`❌ Attempt ${attempts + 1}: AppId ${appId} not found in running servers yet`)
          
        } catch (error) {
          console.log(`❌ Error checking servers: ${error}`)
        }
        
        attempts++
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      
      console.log(`⏰ Timeout waiting for server for appId: ${appId}`)
      
      // Update store to reflect timeout
      set((state) => {
        const server = state.servers.get(appId)
        if (server) {
          server.status = ServerStatus.ERROR
          server.error = 'Timeout waiting for server to start'
          server.isHealthy = false
        }
      })
      
      return null
    },
    
    startHealthMonitoring: (appId: string, delayInitialCheck = false) => {
      console.log(`🔍 Starting health monitoring for appId: ${appId}${delayInitialCheck ? ' (with delayed initial check)' : ''}`)
      
      // Skip if already monitoring
      const existingServer = get().servers.get(appId)
      if (existingServer && existingServer.intervalId) {
        return
      }
      
      const { checkServerHealth } = get()
      
      // Initial health check with optional delay for newly started servers
      if (delayInitialCheck) {
        // Give the server time to start accepting connections (3 seconds)
        console.log(`⏳ Delaying initial health check for ${appId} by 3 seconds to allow server startup`)
        setTimeout(() => checkServerHealth(appId), 3000)
      } else {
        checkServerHealth(appId)
      }
      
      // Set up adaptive periodic monitoring
      const setupHealthCheckInterval = () => {
        const server = get().servers.get(appId)
        if (!server || server.status === ServerStatus.STOPPED) {
          return // Don't start monitoring for stopped servers
        }
        
        const currentInterval = server.healthCheckInterval || get().healthCheckInterval
        
        const intervalId = setInterval(async () => {
          const currentServer = get().servers.get(appId)
          if (!currentServer || currentServer.status === ServerStatus.STOPPED) {
            clearInterval(intervalId)
            return
          }
          
          await checkServerHealth(appId)
          
          // Check if interval changed due to failures and restart with new interval
          const updatedServer = get().servers.get(appId)
          if (updatedServer && updatedServer.healthCheckInterval !== currentInterval) {
            clearInterval(intervalId)
            // Restart with new interval
            setTimeout(() => setupHealthCheckInterval(), 100)
          }
        }, currentInterval)
        
        // Store interval ID for cleanup
        set((state) => {
          const server = state.servers.get(appId)
          if (server) {
            server.intervalId = intervalId
          }
        })
      }
      
      setupHealthCheckInterval()
    },
    
    stopHealthMonitoring: (appId: string) => {
      const server = get().servers.get(appId)
      if (server && server.intervalId) {
        clearInterval(server.intervalId)
        set((state) => {
          const serverInState = state.servers.get(appId)
          if (serverInState) {
            serverInState.intervalId = undefined
          }
        })
      }
    },
    
    // Retry mechanism
    retryConnection: async (appId: string) => {
      const server = get().servers.get(appId)
      if (!server || server.retryCount >= get().maxRetries) {
        return false
      }
      
      set((state) => {
        const srv = state.servers.get(appId)
        if (srv) {
          srv.retryCount += 1
          srv.status = ServerStatus.STARTING
        }
      })
      
      // Wait with exponential backoff
      const backoffMs = get().retryBackoffMs * Math.pow(1.5, server.retryCount)
      await new Promise(resolve => setTimeout(resolve, Math.min(backoffMs, 10000)))
      
      return await get().checkServerHealth(appId)
    },
    
    resetRetryCount: (appId: string) => {
      set((state) => {
        const server = state.servers.get(appId)
        if (server) {
          server.retryCount = 0
        }
      })
    },
    
    // Backend validation functions
    revalidateWithBackend: async (appId: string) => {
      console.log(`🔄 Revalidating server ${appId} with backend`)
      
      try {
        const data = await appService.getServers()
        const servers = data.servers || []
        
        // Look for our specific appId in the running servers
        const serverForApp = servers.find((server: { appId: string; port: number }) => server.appId === appId)
        
        set((state) => {
          const server = state.servers.get(appId)
          if (server) {
            server.lastBackendSync = new Date()
            
            if (serverForApp && serverForApp.port) {
              // Server found in backend, update our state
              console.log(`✅ Backend confirms server ${appId} on port ${serverForApp.port}`)
              server.actualPort = serverForApp.port
              server.status = ServerStatus.RUNNING
              server.isHealthy = true
              server.consecutiveFailures = 0
              server.healthCheckInterval = get().healthCheckInterval // Reset interval
              server.error = undefined
              
              // Restart health monitoring with fresh state
              if (!server.intervalId) {
                get().startHealthMonitoring(appId)
              }
            } else {
              // Server NOT found in backend, mark as stopped
              console.log(`❌ Backend does not list server ${appId}, marking as stopped`)
              server.status = ServerStatus.STOPPED
              server.isHealthy = false
              server.actualPort = undefined
              server.error = 'Server not found in backend'
              
              // Stop health monitoring
              if (server.intervalId) {
                clearInterval(server.intervalId)
                server.intervalId = undefined
              }
            }
          }
        })
        
        return !!serverForApp
      } catch (error) {
        console.error(`❌ Failed to revalidate server ${appId} with backend:`, error)
        
        set((state) => {
          const server = state.servers.get(appId)
          if (server) {
            server.lastBackendSync = new Date()
            server.error = `Backend validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        })
        
        return false
      }
    },
    
    scheduleBackendRevalidation: (appId: string) => {
      // Debounce revalidation to avoid spamming backend
      const existingTimeout = get().revalidationTimeouts?.get(appId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }
      
      const timeout = setTimeout(() => {
        get().revalidateWithBackend(appId)
        set((state) => {
          state.revalidationTimeouts?.delete(appId)
        })
      }, 5000) // Wait 5 seconds before revalidating
      
      set((state) => {
        if (!state.revalidationTimeouts) {
          state.revalidationTimeouts = new Map()
        }
        state.revalidationTimeouts.set(appId, timeout)
      })
    },
    
    startPeriodicBackendSync: () => {
      // Don't start if already running
      if (get().periodicSyncIntervalId) {
        return
      }
      
      console.log('🔄 Starting periodic backend sync (every 30 seconds)')
      
      const intervalId = setInterval(async () => {
        const { servers } = get()
        
        try {
          const data = await appService.getServers()
          const backendServers = data.servers || []
          const backendAppIds = new Set(backendServers.map((s: { appId: string }) => s.appId))
          
          // Check each server in our store
          for (const [appId, server] of servers) {
            const timeSinceSync = server.lastBackendSync ? 
              Date.now() - server.lastBackendSync.getTime() : Infinity
              
            // Skip if recently synced (less than 2 minutes ago)
            if (timeSinceSync < 120000) {
              continue
            }
            
            if (!backendAppIds.has(appId) && server.status !== ServerStatus.STOPPED) {
              // Server in our store but not in backend - likely died
              console.log(`🚨 Periodic sync: Server ${appId} no longer in backend, marking as stopped`)
              
              set((state) => {
                const srv = state.servers.get(appId)
                if (srv) {
                  srv.status = ServerStatus.STOPPED
                  srv.isHealthy = false
                  srv.actualPort = undefined
                  srv.error = 'Server disappeared from backend'
                  srv.lastBackendSync = new Date()
                  
                  // Stop health monitoring
                  if (srv.intervalId) {
                    clearInterval(srv.intervalId)
                    srv.intervalId = undefined
                  }
                }
              })
            } else if (backendAppIds.has(appId)) {
              // Server exists in both - update sync time
              set((state) => {
                const srv = state.servers.get(appId)
                if (srv) {
                  srv.lastBackendSync = new Date()
                }
              })
            }
          }
        } catch (error) {
          console.warn('Periodic backend sync failed:', error)
        }
      }, 30000) // Every 30 seconds
      
      set((state) => {
        state.periodicSyncIntervalId = intervalId
      })
    },
    
    stopPeriodicBackendSync: () => {
      const intervalId = get().periodicSyncIntervalId
      if (intervalId) {
        clearInterval(intervalId)
        console.log('⏹️ Stopped periodic backend sync')
        
        set((state) => {
          state.periodicSyncIntervalId = undefined
        })
      }
    },
    
    // Getters
    getServerInfo: (appId: string) => {
      return get().servers.get(appId)
    },
    
    getServerUrl: (appId: string) => {
      const server = get().servers.get(appId)
      /*console.log(`🔍 getServerUrl for appId ${appId}:`, {
        hasServer: !!server,
        actualPort: server?.actualPort,
        status: server?.status,
        isHealthy: server?.isHealthy,
        allServers: Array.from(get().servers.entries()).map(([id, srv]) => ({ id, port: srv.actualPort, status: srv.status }))
      })*/
      
      // Only return URL if server is confirmed running AND healthy for this specific appId
      if (!server || !server.actualPort || server.status !== ServerStatus.RUNNING || !server.isHealthy) {
        return null
      }
      
      const url = `http://localhost:${server.actualPort}`
      return url
    },
    
    isServerReady: (appId: string) => {
      const server = get().servers.get(appId)
      return server?.status === ServerStatus.RUNNING && server.isHealthy
    },
    
    // Cleanup
    unregisterServer: (appId: string) => {
      get().stopHealthMonitoring(appId)
      
      // Clear any pending revalidation timeouts
      const timeout = get().revalidationTimeouts?.get(appId)
      if (timeout) {
        clearTimeout(timeout)
      }
      
      set((state) => {
        state.servers.delete(appId)
        state.revalidationTimeouts?.delete(appId)
      })
    },
    
    cleanup: () => {
      const { servers, revalidationTimeouts } = get()
      
      // Stop periodic backend sync
      get().stopPeriodicBackendSync()
      
      // Stop all health monitoring
      servers.forEach((_, appId) => {
        get().stopHealthMonitoring(appId)
      })
      
      // Clear all revalidation timeouts
      revalidationTimeouts?.forEach((timeout) => {
        clearTimeout(timeout)
      })
      
      set((state) => {
        state.servers.clear()
        state.revalidationTimeouts?.clear()
      })
    }
  }))
)