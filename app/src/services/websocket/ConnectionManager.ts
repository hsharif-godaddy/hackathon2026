/**
 * ConnectionManager
 *
 * Encapsulates the Socket.IO connection lifecycle:
 * - Dynamic config lookup for WebSocket base URL
 * - JWT token acquisition + refresh on expiration
 * - Session storage management for manual recovery
 * - Shared socket registry coordination
 *
 * The React hook consumes this service via callbacks, keeping UI logic separate
 * from low-level transport details and making the connection logic testable.
 */

import { io, type Socket } from 'socket.io-client'

import { logger } from '@/lib/request-context'
import { getSharedSocket, setSharedSocket } from '@/lib/socketRegistry'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface ConnectionCallbacks {
  /**
   * Invoked whenever the manager produces a socket that requires handler wiring.
   * Called for brand new sockets and for replacements created after token refresh.
   */
  onSocketReady?: (socket: Socket, meta: { isNew: boolean }) => void

  /**
   * Invoked after the socket reports a successful connection.
   */
  onConnect?: (params: { socket: Socket; recovered: boolean }) => void

  /**
   * Invoked when the connection fails irrecoverably (config/token fetch failure or exhausted retries).
   */
  onConnectionFailed?: (error: Error) => void

  /**
   * Invoked when Socket.IO emits a connect_error that is not handled internally (e.g., non-token errors).
   */
  onConnectError?: (error: Error) => void

  /**
   * Invoked when the socket disconnects after being connected.
   */
  onDisconnect?: (params: { reason: Socket.DisconnectReason; socket: Socket }) => void
  onReconnectAttempt?: (params: { socket: Socket; attempt: number }) => void
  onReconnect?: (params: { socket: Socket; attempt: number }) => void
  onReconnectError?: (params: { socket: Socket; error: Error }) => void
  onReconnectFailed?: (params: { socket: Socket }) => void
}

interface ConnectionManagerDependencies {
  delayMs: number
  storage?: StorageLike
  fetchAgentToken: (appId: string) => Promise<string | null>
  getConfigForSite: (appId: string) => Promise<{ baseUrl: string }>
  createSocket: (url: string, options: Record<string, unknown>) => Socket
  getConversationId?: (appId: string) => string | null
}

/**
 * Maximum refresh attempts after the initial token-expired connect_error.
 * Total failures before giving up = 1 initial error + MAX_TOKEN_REFRESH_ATTEMPTS retries.
 */
const MAX_TOKEN_REFRESH_ATTEMPTS = 7

const defaultDelayMs = 500

const getDefaultStorage = (): StorageLike | undefined => {
  if (typeof window === 'undefined') return undefined
  if (!window.sessionStorage) return undefined
  return window.sessionStorage
}

const defaultFetchAgentToken = async (siteId: string): Promise<string | null> => {
  if (typeof document === 'undefined') return null

  try {
    const { appFetch } = await import('@/lib/gasket-config')
    const response = await appFetch('/api/auth/agent-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, expiresInSeconds: 12 * 60 * 60 }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('websocket.token.request_failed', {
        message: 'Failed to get WebSocket agent token',
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        siteId,
      })
      return null
    }

    const data = await response.json()
    const token = data.token

    if (!token) {
      logger.error('websocket.token.missing_field', { appId: siteId })
      return null
    }

    return token
  } catch (error) {
    logger.error('websocket.token.exception', {
      message: 'Failed to get WebSocket auth token',
      error: error instanceof Error ? error.message : String(error),
      siteId,
    })
    return null
  }
}

const defaultGetConfigForSite = async (appId: string): Promise<{ baseUrl: string }> => {
  const { dynamicApiConfigService } = await import('@/config/dynamic-api')
  const config = await dynamicApiConfigService.getConfigForSite(appId)
  return config
}

const defaultCreateSocket = (url: string, options: Record<string, unknown>): Socket => io(url, options)

export class ConnectionManager {
  private socket: Socket | null = null
  private createdHere = false
  private initTimer: ReturnType<typeof setTimeout> | null = null
  private currentAppId: string | null = null
  private callbacks: ConnectionCallbacks | null = null
  private tokenRefreshCount = 0
  private socketUrl: string | null = null
  private connectPromise: Promise<void> | null = null
  private lifecycleHandlersBySocket = new WeakMap<
    Socket,
    {
      onConnect: () => void
      onConnectError: (error: Error) => void
      onDisconnect: (reason: Socket.DisconnectReason) => void
      onReconnectAttempt: (attempt: number) => void
      onReconnect: (attempt: number) => void
      onReconnectError: (error: Error) => void
      onReconnectFailed: () => void
      onError: (error: Error) => void
    }
  >()

  private readonly deps: ConnectionManagerDependencies

  constructor(
    options: Partial<ConnectionManagerDependencies> = {}
  ) {
    this.deps = {
      delayMs: options.delayMs ?? defaultDelayMs,
      storage: options.storage ?? getDefaultStorage(),
      fetchAgentToken: options.fetchAgentToken ?? defaultFetchAgentToken,
      getConfigForSite: options.getConfigForSite ?? defaultGetConfigForSite,
      createSocket: options.createSocket ?? defaultCreateSocket,
      getConversationId: options.getConversationId,
    }
  }

  /**
   * Establish (or reuse) a Socket.IO connection for the given appId.
   * Returns a promise so callers can await initialization in tests, but UI code can ignore it.
   */
  async connect(appId: string, callbacks: ConnectionCallbacks = {}): Promise<void> {
    this.callbacks = callbacks
    this.currentAppId = appId

    const sharedSocket = getSharedSocket()
    if (sharedSocket) {
      // Check if shared socket is for the same app (appId is in auth, not query)
      const opts = sharedSocket.io?.opts as { auth?: { appId?: string } } | undefined
      const socketAppId = opts?.auth?.appId
      if (socketAppId === appId) {
        // Reuse shared socket for same app.
        // IMPORTANT: When reusing, we must still wire lifecycle handlers and notify callbacks.
        // Otherwise, downstream state machines can get stuck in "connecting" even though
        // the underlying socket is already connected.
        this.socket = sharedSocket
        // This project uses ConnectionManager only for the main streaming connection.
        // Treat the reused shared socket as "owned" here so disconnect() can clean it up.
        this.createdHere = true
        this.registerLifecycleHandlers(sharedSocket, appId)
        callbacks.onSocketReady?.(sharedSocket, { isNew: false })
        if (sharedSocket.connected) {
          // If already connected, connect event won't re-fire; proactively notify.
          callbacks.onConnect?.({ socket: sharedSocket, recovered: false })
        } else {
          // Ensure the socket is actively connecting so we eventually get onConnect.
          sharedSocket.connect()
        }
        return Promise.resolve()
      }

      // Different app - clear stale shared socket
      sharedSocket.disconnect()
      setSharedSocket(null)
    }

    if (this.initTimer) {
      clearTimeout(this.initTimer)
      this.initTimer = null
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = new Promise<void>((resolve) => {
      this.initTimer = setTimeout(() => {
        this.initTimer = null
        void this.initializeSocket(appId).finally(() => {
          this.connectPromise = null
          resolve()
        })
      }, this.deps.delayMs)
    })

    return this.connectPromise
  }

  /**
   * Disconnect the underlying socket if this manager created it.
   * Reused shared sockets remain untouched to avoid disrupting other consumers.
   */
  disconnect(): void {
    // Clear currentAppId first to signal any in-flight async operations to abort
    this.currentAppId = null

    if (this.initTimer) {
      clearTimeout(this.initTimer)
      this.initTimer = null
    }
    this.connectPromise = null

    if (this.socket) {
      this.unregisterLifecycleHandlers(this.socket)

      if (this.createdHere) {
        this.socket.removeAllListeners()
        if (this.socket.io) {
          this.socket.io.reconnection(false)
        }
        this.socket.disconnect()
        setSharedSocket(null)
      }
    }

    this.socket = null
    this.createdHere = false
    this.callbacks = null
    this.tokenRefreshCount = 0
    this.socketUrl = null
  }

  /**
   * Current socket accessor for callers that need direct interaction (e.g., sendMessage).
   */
  getSocket(): Socket | null {
    return this.socket
  }

  private async initializeSocket(appId: string): Promise<void> {
    // Guard: If appId changed during async operations, abort this initialization
    // This prevents creating a socket for a stale appId
    if (appId !== this.currentAppId) {
      return
    }

    try {
      const config = await this.deps.getConfigForSite(appId)

      // Re-check after async operation
      if (appId !== this.currentAppId) {
        return
      }

      this.socketUrl = config.baseUrl

      const token = await this.deps.fetchAgentToken(appId)

      // Re-check after async operation
      if (appId !== this.currentAppId) {
        return
      }

      if (!token) {
        this.callbacks?.onConnectionFailed?.(new Error('Failed to acquire authentication token'))
        return
      }

      const previousSocketId = this.getStoredSocketId(appId)

      this.createAndRegisterSocket({
        appId,
        token,
        previousSocketId,
        isNew: true,
      })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('websocket.connection.init_failed', {
        message: err.message,
        stack: err.stack,
        appId,
      })
      this.callbacks?.onConnectionFailed?.(err)
    }
  }

  private createAndRegisterSocket(params: {
    appId: string
    token: string | null
    previousSocketId: string | null
    isNew: boolean
  }): void {
    if (!this.socketUrl) {
      const error = new Error('Socket URL not initialized')
      logger.error('websocket.connection.missing_url', { appId: params.appId })
      this.callbacks?.onConnectionFailed?.(error)
      return
    }

    const { appId, token, previousSocketId, isNew } = params

    const conversationId =
      this.deps.getConversationId && appId ? this.deps.getConversationId(appId) : null

    const socketOptions: Record<string, unknown> = {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      pingInterval: 15000,
      pingTimeout: 15000,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 60,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      auth: {
        ...(token && { token }),
        ...(previousSocketId && { previousSocketId }),
        ...(conversationId && { conversationId }),
        appId,
      },
    }

    if (token) {
      socketOptions.extraHeaders = { Authorization: `Bearer ${token}` }
    }

    const socket = this.deps.createSocket(this.socketUrl, socketOptions)

    this.socket = socket
    this.createdHere = true

    this.registerLifecycleHandlers(socket, appId)

    // Share the socket globally for other consumers (e.g., OAuth popup)
    setSharedSocket(socket)

    this.callbacks?.onSocketReady?.(socket, { isNew })

    socket.connect()
  }

  private registerLifecycleHandlers(socket: Socket, appId: string): void {
    // Avoid accumulating duplicate listeners when reusing the shared socket across mounts.
    this.unregisterLifecycleHandlers(socket)

    const handlers = {
      onConnect: () => {
        const previousSocketId = this.getStoredSocketId(appId)

        const recovered = !!(previousSocketId && previousSocketId !== socket.id)

        this.storeSocketId(appId, socket.id)
        this.tokenRefreshCount = 0

        this.callbacks?.onConnect?.({ socket, recovered })
      },

      onConnectError: (error: Error) => {
        void this.handleConnectError(error, appId)
      },

      onDisconnect: (reason: Socket.DisconnectReason) => {
        this.callbacks?.onDisconnect?.({ reason, socket })
      },

      onReconnectAttempt: (attempt: number) => {
        this.callbacks?.onReconnectAttempt?.({ socket, attempt })
      },

      onReconnect: (attempt: number) => {
        this.callbacks?.onReconnect?.({ socket, attempt })
      },

      onReconnectError: (error: Error) => {
        this.callbacks?.onReconnectError?.({ socket, error })
      },

      onReconnectFailed: () => {
        this.callbacks?.onReconnectFailed?.({ socket })
      },

      onError: (error: Error) => {
        logger.error('websocket.connection.error', {
          appId,
          message: error.message,
          stack: error.stack,
        })
      },
    }

    this.lifecycleHandlersBySocket.set(socket, handlers)

    socket.on('connect', handlers.onConnect)
    socket.on('connect_error', handlers.onConnectError)
    socket.on('disconnect', handlers.onDisconnect)
    socket.on('reconnect_attempt', handlers.onReconnectAttempt)
    socket.on('reconnect', handlers.onReconnect)
    socket.on('reconnect_error', handlers.onReconnectError)
    socket.on('reconnect_failed', handlers.onReconnectFailed)
    socket.on('error', handlers.onError)
  }

  private unregisterLifecycleHandlers(socket: Socket): void {
    const handlers = this.lifecycleHandlersBySocket.get(socket)
    if (!handlers) return

    socket.off('connect', handlers.onConnect)
    socket.off('connect_error', handlers.onConnectError)
    socket.off('disconnect', handlers.onDisconnect)
    socket.off('reconnect_attempt', handlers.onReconnectAttempt)
    socket.off('reconnect', handlers.onReconnect)
    socket.off('reconnect_error', handlers.onReconnectError)
    socket.off('reconnect_failed', handlers.onReconnectFailed)
    socket.off('error', handlers.onError)

    this.lifecycleHandlersBySocket.delete(socket)
  }

  private async handleConnectError(error: Error, appId: string): Promise<void> {
    const message = error.message || String(error)

    if (message.includes('JWT validation failed') && message.includes('Token expired')) {
      await this.handleTokenExpiration(appId)
      return
    }

    this.callbacks?.onConnectError?.(error)
  }

  private async handleTokenExpiration(appId: string): Promise<void> {
    if (this.tokenRefreshCount >= MAX_TOKEN_REFRESH_ATTEMPTS) {
      logger.error('websocket.token.refresh_limit_exceeded', {
        message: 'Maximum token refresh attempts exceeded, rejecting connection',
        appId,
        attempts: this.tokenRefreshCount,
      })

      this.callbacks?.onConnectionFailed?.(
        new Error('Failed to establish connection after multiple token refresh attempts')
      )
      return
    }

    this.tokenRefreshCount += 1

    const newToken = await this.deps.fetchAgentToken(appId)

    if (!newToken) {
      this.callbacks?.onConnectionFailed?.(new Error('Failed to refresh authentication token'))
      return
    }

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
    }

    const previousSocketId = this.getStoredSocketId(appId)

    this.createAndRegisterSocket({
      appId,
      token: newToken,
      previousSocketId,
      isNew: true,
    })
  }

  private getStoredSocketId(appId: string): string | null {
    if (!this.deps.storage) {
      logger.debug('websocket.socket_id.no_storage', { appId })
      return null
    }
    const key = this.getStorageKey(appId)
    const socketId = this.deps.storage.getItem(key)
    logger.debug('websocket.socket_id.retrieved', { appId, socketId, key, found: !!socketId })
    return socketId
  }

  private storeSocketId(appId: string, socketId: string): void {
    if (!this.deps.storage) return
    const key = this.getStorageKey(appId)
    this.deps.storage.setItem(key, socketId)
    logger.debug('websocket.socket_id.stored', { appId, socketId, key })
  }

  private getStorageKey(appId: string): string {
    return `socket_id_${appId}`
  }
}
