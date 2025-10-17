import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

// Enable Immer MapSet plugin for Map support
enableMapSet()

export interface ServerState {
  appId: string
  port: number | null
  url: string | null
  status: 'pending' | 'running' | 'stopped' | 'failed' | 'error'
  lastActivity?: string
  isReady: boolean
  error?: string
}

interface PollingState {
  server: ServerState | null
  isPolling: boolean
  pollCount: number
  currentInterval: number
  timeoutId: NodeJS.Timeout | null
  lastPollTime: number | null
}

interface ServerPollingStore {
  // State per server
  servers: Map<string, PollingState>

  // Actions
  startPollingForServer: (appId: string) => void
  stopPollingForServer: (appId: string) => void
  getServerState: (appId: string) => ServerState | null
  isPollingServer: (appId: string) => boolean
  cleanup: () => void

  // Internal polling logic
  _pollServer: (appId: string) => Promise<void>
  _scheduleNextPoll: (appId: string) => void
  _calculateNextInterval: (pollCount: number) => number
}

// Adaptive polling intervals (in ms)
const POLLING_INTERVALS = {
  initial: 1000,     // 1 second initially
  fast: 2000,        // 2 seconds for first 10 polls
  medium: 5000,      // 5 seconds for next 20 polls
  slow: 15000,       // 15 seconds for next 30 polls
  slowest: 30000     // 30 seconds thereafter
}

const MAX_POLLS = {
  fast: 10,
  medium: 30,
  slow: 60
}

export const useServerPollingStore = create<ServerPollingStore>()(
  devtools(
    immer((set, get) => ({
    servers: new Map(),

    startPollingForServer: (appId: string) => {
      const existing = get().servers.get(appId)

      // Don't start if already polling
      if (existing?.isPolling) {
        logger.debug('server-polling.already-active', { message: 'Already polling server', appId })
        return
      }

      logger.info('server-polling.start', { message: 'Starting polling for server', appId })

      set((state) => {
        state.servers.set(appId, {
          server: null,
          isPolling: true,
          pollCount: 0,
          currentInterval: POLLING_INTERVALS.initial,
          timeoutId: null,
          lastPollTime: null
        })
      })

      // Start immediate poll
      get()._pollServer(appId)
    },

    stopPollingForServer: (appId: string) => {
      const pollingState = get().servers.get(appId)

      if (!pollingState) return

      logger.info('server-polling.stop', { message: 'Stopping polling for server', appId })

      // Clear any pending timeout
      if (pollingState.timeoutId) {
        clearTimeout(pollingState.timeoutId)
      }

      set((state) => {
        const existingState = state.servers.get(appId)
        if (existingState) {
          existingState.isPolling = false
          existingState.timeoutId = null
        }
      })
    },

    getServerState: (appId: string) => {
      return get().servers.get(appId)?.server || null
    },

    isPollingServer: (appId: string) => {
      return get().servers.get(appId)?.isPolling || false
    },

    cleanup: () => {
      const { servers } = get()

      // Stop all polling
      for (const [_appId, pollingState] of servers) { // eslint-disable-line @typescript-eslint/no-unused-vars
        if (pollingState.timeoutId) {
          clearTimeout(pollingState.timeoutId)
        }
      }

      set((state) => {
        state.servers.clear()
      })

      logger.info('server-polling.cleanup', { message: 'Cleaned up all server polling' })
    },

    _pollServer: async (appId: string) => {
      const pollingState = get().servers.get(appId)

      if (!pollingState || !pollingState.isPolling) {
        logger.debug('server-polling.already-stopped', { message: 'Polling stopped', appId })
        return
      }

      try {
        logger.debug('server-polling.attempt', { message: 'Polling server', appId, attempt: pollingState.pollCount + 1 })

        const response = await appFetch(`/api/servers/${appId}`)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        const serverData = data.server

        set((state) => {
          const currentState = state.servers.get(appId)
          if (currentState) {
            currentState.server = {
              appId: serverData.appId,
              port: serverData.port,
              url: serverData.url,
              status: serverData.status,
              lastActivity: serverData.lastActivity,
              isReady: serverData.status === 'running' && !!serverData.url,
              error: undefined
            }
            currentState.pollCount++
            currentState.lastPollTime = Date.now()
          }
        })

        // Stop polling if server is ready
        if (serverData.status === 'running' && serverData.url) {
          logger.info('server-polling.ready', { message: 'Server is ready', appId, url: serverData.url })
          get().stopPollingForServer(appId)
          return
        }

        // Stop polling if server failed permanently
        if (serverData.status === 'failed') {
          logger.warn('server-polling.failed', { message: 'Server failed permanently', appId })
          get().stopPollingForServer(appId)
          return
        }

        // Schedule next poll with backoff
        get()._scheduleNextPoll(appId)

      } catch (error) {
        logger.error('server-polling.error', { message: 'Error polling server', appId, error: error instanceof Error ? error.message : String(error) })

        set((state) => {
          const currentState = state.servers.get(appId)
          if (currentState) {
            currentState.server = {
              appId,
              port: null,
              url: null,
              status: 'error',
              isReady: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
            currentState.pollCount++
            currentState.lastPollTime = Date.now()
          }
        })

        // Continue polling on error, but with backoff
        get()._scheduleNextPoll(appId)
      }
    },

    _scheduleNextPoll: (appId: string) => {
      const pollingState = get().servers.get(appId)

      if (!pollingState || !pollingState.isPolling) return

      const nextInterval = get()._calculateNextInterval(pollingState.pollCount)

      logger.debug('server-polling.schedule', { message: 'Scheduling next poll', appId, nextInterval, attempt: pollingState.pollCount + 1 })

      const timeoutId = setTimeout(() => {
        get()._pollServer(appId)
      }, nextInterval)

      set((state) => {
        const currentState = state.servers.get(appId)
        if (currentState) {
          currentState.timeoutId = timeoutId
          currentState.currentInterval = nextInterval
        }
      })
    },

    _calculateNextInterval: (pollCount: number) => {
      if (pollCount < MAX_POLLS.fast) {
        return POLLING_INTERVALS.fast
      } else if (pollCount < MAX_POLLS.medium) {
        return POLLING_INTERVALS.medium
      } else if (pollCount < MAX_POLLS.slow) {
        return POLLING_INTERVALS.slow
      } else {
        return POLLING_INTERVALS.slowest
      }
    }
  })),
    { name: 'ServerPollingStore' }
  )
)

// Cleanup function for use in components
export const cleanupServerPolling = () => {
  useServerPollingStore.getState().cleanup()
}
