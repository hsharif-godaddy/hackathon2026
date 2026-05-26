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

import { type DisconnectDescription, io, type Socket } from 'socket.io-client'

import type { AgentTokenResponse } from '@/lib/agent-fetch'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { getSharedSocket, setSharedSocket } from '@/lib/socketRegistry'
import { useBillingModeStore } from '@/stores/useBillingModeStore'
import type { ServerConfig } from './stateMachineTypes'

/**
 * Toggle for connection diagnostics logging.
 * When true, emits detailed phase-level timing at info level.
 * The enhanced `slow_connect` warning (>10s) always includes phase data regardless.
 * Flip to false once the slow-connect root cause is resolved.
 */
const CONNECTION_DIAGNOSTICS_ENABLED = true

export interface ConnectionPhases {
  connectAttemptId: string
  configFetchMs: number
  tokenFetchMs: number
  socketConnectMs?: number
  authMs?: number
  tokenResourceTiming?: {
    serverProcessingMs: number
    transferMs: number
    totalFetchMs: number
    connectionReused: boolean
  }
  wsResourceTiming?: {
    dnsMs: number
    tcpMs: number
    tlsMs: number
    wsHandshakeMs: number
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Socket.IO auth can be an object or a callback. This narrows to the object form and checks for a token. */
function hasAuthToken(auth: Socket['auth']): boolean {
  return typeof auth === 'object' && auth !== null && 'token' in auth && !!auth.token
}

export interface ConnectionCallbacks {
  /**
   * Invoked whenever the manager produces a socket that requires handler wiring.
   * Called for brand new sockets and for replacements created after token refresh.
   */
  onSocketReady?: (socket: Socket, meta: { isNew: boolean }) => void

  /**
   * Invoked after the socket reports a successful connection (transport-level).
   */
  onConnect?: (params: { socket: Socket; recovered: boolean }) => void

  /**
   * Invoked after the socket successfully authenticates via the `authenticate` event.
   */
  onAuthenticated?: (params: { socket: Socket }) => void

  /**
   * Invoked when authentication fails over the established connection.
   */
  onAuthFailed?: (error: Error) => void

  /**
   * Invoked when the connection fails irrecoverably (config/token fetch failure or exhausted retries).
   */
  onConnectionFailed?: (error: Error) => void

  /**
   * Invoked when Socket.IO emits a connect_error that is not handled internally (e.g., non-token errors).
   */
  onConnectError?: (error: Error) => void

  /**
   * Invoked with phase-level timing data after connection completes (for NetworkQualityMonitor).
   */
  onConnectionPhases?: (phases: ConnectionPhases) => void

  /**
   * Invoked when the socket disconnects after being connected.
   */
  onDisconnect?: (params: { reason: Socket.DisconnectReason; socket: Socket; description?: DisconnectDescription }) => void
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
    const fetchStart = Date.now()
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
      shipAnalyticsLog('funnel.ws.token_failed', {
        appId: siteId,
        error: errorText.substring(0, 200),
        status: response.status,
      })
      return null
    }

    const data: AgentTokenResponse = await response.json()
    const token = data.token

    if (!token) {
      logger.error('websocket.token.missing_field', { appId: siteId })
      shipAnalyticsLog('funnel.ws.token_failed', {
        appId: siteId,
        error: 'Token field missing from response',
      })
      return null
    }

    useBillingModeStore.getState().setMode(siteId, data.budgetServiceEnabled)

    shipAnalyticsLog('funnel.ws.token_acquired', {
      appId: siteId,
      durationMs: Date.now() - fetchStart,
    })
    return token
  } catch (error) {
    logger.error('websocket.token.exception', {
      message: 'Failed to get WebSocket auth token',
      error: error instanceof Error ? error.message : String(error),
      siteId,
    })
    shipAnalyticsLog('funnel.ws.token_failed', {
      appId: siteId,
      error: error instanceof Error ? error.message : String(error),
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
  /**
   * Incremented when a new delayed init starts and when disconnect() invalidates in-flight work.
   * initializeSocket's finally only clears connectPromise when its captured generation matches,
   * so a stale async completion cannot wipe a newer connect's promise.
   */
  private connectOpGeneration = 0
  private connectionPhases: ConnectionPhases | null = null
  private connectAttemptStart: number | null = null
  private cachedToken: string | null = null
  private authTimeoutId: ReturnType<typeof setTimeout> | null = null
  /**
   * When true, the socket was created as a fallback for an old server that
   * doesn't support connect-then-auth. The old server already validated the
   * token in io.use() middleware, so we skip emitting `authenticate` and go
   * straight to onAuthenticated.
   */
  private handshakeAuthMode = false
  /** Guards funnel.ws.connected to fire once per session (not on reconnects). Reset in disconnect(). */
  private hasFiredFunnelConnected = false
  /** Snapshot of connectAttemptStart captured in onConnect before nulling, for durationMs calculation. */
  private connectStartSnapshot: number | null = null
  /**
   * Reference to the latest server config, shared with TransportSupervisor.
   * Used to read supportsConnectThenAuth for reconnection decisions
   * and ackTimeout for auth timeout.
   */
  private serverConfigRef: { current: ServerConfig | null } = { current: null }
  private lifecycleHandlersBySocket = new WeakMap<
    Socket,
    {
      onConnect: () => void
      onConnectError: (error: Error) => void
      onDisconnect: (reason: Socket.DisconnectReason, description?: DisconnectDescription) => void
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

    const opGen = ++this.connectOpGeneration

    this.connectPromise = new Promise<void>((resolve) => {
      this.initTimer = setTimeout(() => {
        this.initTimer = null
        void this.initializeSocket(appId).finally(() => {
          if (opGen === this.connectOpGeneration) {
            this.connectPromise = null
          }
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
    this.connectOpGeneration++
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

    if (this.authTimeoutId) {
      clearTimeout(this.authTimeoutId)
      this.authTimeoutId = null
    }

    this.socket = null
    this.createdHere = false
    this.callbacks = null
    this.tokenRefreshCount = 0
    this.socketUrl = null
    this.connectionPhases = null
    this.connectAttemptStart = null
    this.cachedToken = null
    this.handshakeAuthMode = false
    this.hasFiredFunnelConnected = false
    this.connectStartSnapshot = null
  }

  /**
   * Current socket accessor for callers that need direct interaction (e.g., sendMessage).
   */
  getSocket(): Socket | null {
    return this.socket
  }

  /**
   * Set the server config reference. Called by TransportSupervisor to share
   * the config ref so ConnectionManager can read capability flags.
   */
  setServerConfigRef(ref: { current: ServerConfig | null }): void {
    this.serverConfigRef = ref
  }

  private async initializeSocket(appId: string): Promise<void> {
    // Guard: If appId changed during async operations, abort this initialization
    // This prevents creating a socket for a stale appId
    if (appId !== this.currentAppId) {
      return
    }

    const initStart = Date.now()
    const connectAttemptId = `${appId}-${initStart}-${Math.random().toString(36).slice(2, 6)}`

    try {
      // Phase 1: Start token fetch in parallel, await only config (needed for URL)
      const tokenStart = Date.now()
      const tokenPromise = this.deps.fetchAgentToken(appId)

      const configStart = Date.now()
      const config = await this.deps.getConfigForSite(appId)
      const configFetchMs = Date.now() - configStart

      // Re-check after async operations
      if (appId !== this.currentAppId) {
        return
      }

      this.socketUrl = config.baseUrl

      // Collect Resource Timing for the token fetch (same-origin, full timing available)
      const tokenResourceTiming = this.getTokenResourceTiming()

      // Initialize phase data — socketConnectMs and authMs will be set later
      this.connectionPhases = {
        connectAttemptId,
        configFetchMs,
        tokenFetchMs: 0, // Updated when token resolves
        ...(tokenResourceTiming && { tokenResourceTiming }),
      }
      this.connectAttemptStart = Date.now()

      const previousSocketId = this.getStoredSocketId(appId)

      // Phase 2: Connect without token (connect-then-auth)
      this.createAndRegisterSocket({
        appId,
        token: null,
        previousSocketId,
        isNew: true,
        connectAttemptId,
      })

      // Phase 3: Await token, then authenticate over the established socket
      const token = await tokenPromise
      const tokenFetchMs = Date.now() - tokenStart

      if (this.connectionPhases) {
        this.connectionPhases.tokenFetchMs = tokenFetchMs
      }

      // Re-check after async operations
      if (appId !== this.currentAppId) {
        return
      }

      if (!token) {
        // Clean up the socket we created since we can't authenticate
        if (this.socket && this.createdHere) {
          this.socket.removeAllListeners()
          this.socket.disconnect()
          this.socket = null
          setSharedSocket(null)
        }
        shipAnalyticsLog('funnel.ws.connect_failed', {
          appId,
          error: 'Failed to acquire authentication token',
          reason: 'token_failed',
        })
        this.callbacks?.onConnectionFailed?.(new Error('Failed to acquire authentication token'))
        return
      }

      this.cachedToken = token

      // Authenticate once the socket is connected (or queue for when it connects)
      if (this.socket && !this.handshakeAuthMode) {
        this.authenticateSocket(this.socket, token, appId)
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('websocket.connection.init_failed', {
        message: err.message,
        stack: err.stack,
        appId,
        connectAttemptId,
      })
      this.callbacks?.onConnectionFailed?.(err)
    }
  }

  /**
   * Authenticate over an established socket connection.
   * Emits `authenticate` with the JWT, listens for success/failure responses.
   */
  private authenticateSocket(socket: Socket, token: string, appId: string): void {
    if (!socket.connected) {
      // Socket not yet connected; authentication will be triggered in the onConnect handler
      return
    }

    const authStart = Date.now()

    // Clear any previous auth timeout
    if (this.authTimeoutId) {
      clearTimeout(this.authTimeoutId)
      this.authTimeoutId = null
    }

    const onAuthSuccess = (_data: { socketId?: string }) => {
      cleanup()

      // Guard against stale auth responses after appId change
      if (appId !== this.currentAppId) {
        logger.debug('websocket.auth.stale_success', {
          appId,
          currentAppId: this.currentAppId,
        })
        return
      }

      const authMs = Date.now() - authStart
      if (this.connectionPhases) {
        this.connectionPhases.authMs = authMs
      }

      // Log full phase breakdown now that auth is complete
      if (CONNECTION_DIAGNOSTICS_ENABLED && this.connectionPhases) {
        logger.info('websocket.connection.phases', {
          appId,
          socketId: socket.id,
          ...this.connectionPhases,
        })
      }

      // Notify callback (NetworkQualityMonitor consumes this)
      if (this.connectionPhases) {
        this.callbacks?.onConnectionPhases?.(this.connectionPhases)
      }

      // Funnel event: WebSocket fully connected and authenticated (once per session)
      if (!this.hasFiredFunnelConnected) {
        this.hasFiredFunnelConnected = true
        shipAnalyticsLog('funnel.ws.connected', {
          appId,
          durationMs: this.connectStartSnapshot ? Date.now() - this.connectStartSnapshot : undefined,
        })
      }

      this.callbacks?.onAuthenticated?.({ socket })
    }

    const onAuthError = (data: { error?: string }) => {
      cleanup()

      // Guard against stale auth responses after appId change
      if (appId !== this.currentAppId) {
        return
      }

      // Clear cached token to force a fresh fetch on retry
      this.cachedToken = null

      const error = new Error(data?.error ?? 'Authentication failed')
      logger.error('websocket.auth.error', {
        appId,
        socketId: socket.id,
        error: error.message,
      })
      shipAnalyticsLog('funnel.ws.connect_failed', {
        appId,
        error: error.message,
        reason: 'auth_rejected',
      })
      this.callbacks?.onAuthFailed?.(error)
    }

    const cleanup = () => {
      socket.off('authenticateSuccess', onAuthSuccess)
      socket.off('authenticateError', onAuthError)
      if (this.authTimeoutId) {
        clearTimeout(this.authTimeoutId)
        this.authTimeoutId = null
      }
    }

    // Client-side auth timeout. Use server-provided ackTimeout if available,
    // otherwise fall back to 30s (matching server-side AUTH_TIMEOUT_MS default).
    const authTimeoutMs = this.serverConfigRef.current?.ackTimeout ?? 30_000
    this.authTimeoutId = setTimeout(() => {
      cleanup()
      // Clear cached token to force a fresh fetch on retry
      this.cachedToken = null
      logger.warn('websocket.auth.client_timeout', {
        appId,
        socketId: socket.id,
        timeoutMs: authTimeoutMs,
      })
      // Explicitly close the socket so the machine's AUTH_TIMEOUT (35s safety net)
      // sees an already-gone socket rather than a live unauthenticated one.
      socket.disconnect()
      this.callbacks?.onAuthFailed?.(new Error('Authentication timed out'))
    }, authTimeoutMs)

    socket.on('authenticateSuccess', onAuthSuccess)
    socket.on('authenticateError', onAuthError)

    socket.emit('authenticate', { token })
  }

  /**
   * Query browser Performance API for the agent-token fetch Resource Timing entry.
   * Same-origin, so full timing is available without Timing-Allow-Origin.
   */
  private getTokenResourceTiming(): ConnectionPhases['tokenResourceTiming'] | null {
    if (typeof performance === 'undefined') return null
    try {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const entry = entries.filter(e => e.name.includes('/api/auth/agent-token')).pop()
      if (!entry) return null
      return {
        serverProcessingMs: Math.round(entry.responseStart - entry.requestStart),
        transferMs: Math.round(entry.responseEnd - entry.responseStart),
        totalFetchMs: Math.round(entry.responseEnd - entry.startTime),
        connectionReused: entry.connectEnd - entry.connectStart === 0,
      }
    } catch {
      return null
    }
  }

  /**
   * Query browser Performance API for the WebSocket connection Resource Timing entry.
   * Cross-origin — requires Timing-Allow-Origin header from agents server for detailed breakdown.
   */
  private getWsResourceTiming(agentBaseUrl: string): ConnectionPhases['wsResourceTiming'] | null {
    if (typeof performance === 'undefined') return null
    try {
      const agentUrl = new URL(agentBaseUrl)
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]

      // Match by hostname and prefer WebSocket transport entries.
      // Socket.IO may create both HTTP polling and WS upgrade entries for the same host.
      const hostEntries = entries.filter(e => {
        try {
          const entryUrl = new URL(e.name)
          return entryUrl.hostname === agentUrl.hostname
        } catch {
          return false
        }
      })

      // Prefer ws:/wss: entries; fall back to the most recent matching entry
      const wsEntry =
        hostEntries.filter(e => e.name.startsWith('ws:') || e.name.startsWith('wss:')).pop() ??
        hostEntries.pop()

      if (!wsEntry) return null
      return {
        dnsMs: Math.round(wsEntry.domainLookupEnd - wsEntry.domainLookupStart),
        tcpMs: Math.round(
          wsEntry.secureConnectionStart > 0
            ? wsEntry.secureConnectionStart - wsEntry.connectStart
            : wsEntry.connectEnd - wsEntry.connectStart
        ),
        tlsMs: Math.round(
          wsEntry.secureConnectionStart > 0
            ? wsEntry.connectEnd - wsEntry.secureConnectionStart
            : 0
        ),
        wsHandshakeMs: Math.round(wsEntry.responseStart - wsEntry.requestStart),
      }
    } catch {
      return null
    }
  }

  private createAndRegisterSocket(params: {
    appId: string
    token: string | null
    previousSocketId: string | null
    isNew: boolean
    connectAttemptId?: string
  }): void {
    if (!this.socketUrl) {
      const error = new Error('Socket URL not initialized')
      logger.error('websocket.connection.missing_url', { appId: params.appId })
      this.callbacks?.onConnectionFailed?.(error)
      return
    }

    const { appId, token, previousSocketId, isNew, connectAttemptId } = params

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

    const socketConnectStart = Date.now()
    socket.connect()

    // Attach engine transport event listeners for diagnostics
    if (CONNECTION_DIAGNOSTICS_ENABLED && connectAttemptId) {
      this.attachEngineListeners(socket, appId, connectAttemptId, socketConnectStart)
    }
  }

  /**
   * Attach listeners to Socket.IO engine for transport-level diagnostics.
   */
  private attachEngineListeners(
    socket: Socket,
    appId: string,
    connectAttemptId: string,
    socketConnectStart: number
  ): void {
    // Engine is synchronously available after socket.connect() — Manager.open()
    // creates the Engine.IO client before initiating the async handshake.
    const engine = (socket as any).io?.engine
    if (!engine) return

    engine.once('open', () => {
      const durationMs = Date.now() - socketConnectStart
      logger.info('websocket.transport.engine_open', {
        appId,
        connectAttemptId,
        transport: engine.transport?.name,
        durationMs,
      })
    })

    engine.on('upgrade', (transport: any) => {
      logger.info('websocket.transport.upgraded', {
        appId,
        connectAttemptId,
        transport: transport?.name,
      })
    })

    engine.on('upgradeError', (error: Error) => {
      logger.warn('websocket.transport.upgrade_failed', {
        appId,
        connectAttemptId,
        error: error?.message,
      })
    })

    engine.once('close', (reason: string) => {
      logger.info('websocket.transport.engine_close', {
        appId,
        connectAttemptId,
        reason,
      })
    })
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

        // Capture before nulling — used by funnel.ws.connected events below and in onAuthSuccess
        this.connectStartSnapshot = this.connectAttemptStart
        const connectStartSnapshot = this.connectStartSnapshot

        // Compute socket connect duration
        if (this.connectionPhases && connectStartSnapshot) {
          this.connectionPhases.socketConnectMs = Date.now() - connectStartSnapshot
          this.connectAttemptStart = null

          // Collect WS Resource Timing (cross-origin — needs Timing-Allow-Origin)
          if (this.socketUrl) {
            const wsResourceTiming = this.getWsResourceTiming(this.socketUrl)
            if (wsResourceTiming) {
              this.connectionPhases.wsResourceTiming = wsResourceTiming
            }
          }
        }

        this.callbacks?.onConnect?.({ socket, recovered })

        // Fallback path: old server already authenticated via io.use() — skip authenticate event
        if (this.handshakeAuthMode) {
          this.handshakeAuthMode = false
          if (!this.hasFiredFunnelConnected) {
            this.hasFiredFunnelConnected = true
            shipAnalyticsLog('funnel.ws.connected', {
              appId,
              durationMs: connectStartSnapshot ? Date.now() - connectStartSnapshot : undefined,
            })
          }
          this.callbacks?.onAuthenticated?.({ socket })
          return
        }

        // If a token was included in the handshake auth at socket construction time
        // (handshakeAuthMode fallback, handleTokenExpiration, or Socket.IO auto-reconnect
        // of such a socket), the server already validated it in io.use() middleware.
        // Skip the authenticate event — the server has no handler for it in handshake-auth
        // mode and sending it would cause a 30s auth timeout on old servers.
        if (hasAuthToken(socket.auth)) {
          if (!this.hasFiredFunnelConnected) {
            this.hasFiredFunnelConnected = true
            shipAnalyticsLog('funnel.ws.connected', {
              appId,
              durationMs: connectStartSnapshot ? Date.now() - connectStartSnapshot : undefined,
            })
          }
          this.callbacks?.onAuthenticated?.({ socket })
          return
        }

        // Connect-then-auth: no token in handshake, authenticate over the established connection.
        // Always use cachedToken — tokens are never stored in socket.auth to prevent
        // Socket.IO auto-reconnect from sending a stale token in the handshake,
        // which would cause the server to skip pendingAuth and send recovery data
        // before the client has explicitly authenticated.
        if (this.cachedToken) {
          this.authenticateSocket(socket, this.cachedToken, appId)
        }
      },

      onConnectError: (error: Error) => {
        // Clear handshakeAuthMode so a failed fallback doesn't cause the next
        // normal connection to skip authentication
        this.handshakeAuthMode = false
        void this.handleConnectError(error, appId)
      },

      onDisconnect: (reason: Socket.DisconnectReason, description?: DisconnectDescription) => {
        if (this.authTimeoutId) {
          clearTimeout(this.authTimeoutId)
          this.authTimeoutId = null
        }

        // Log disconnect reason with optional description and transport info from Socket.IO
        // Disconnect reason mapping:
        // 'io server disconnect' - server forcefully closed connection
        // 'io client disconnect' - client called disconnect()
        // 'ping timeout' - client didn't respond to pings
        // 'transport close' - underlying connection closed
        // 'transport error' - transport-level error
        const logData: Record<string, unknown> = {
          appId,
          socketId: socket.id,
          reason,
        }

        // Extract transport name if available (defensive access for test compatibility)
        const transportName = socket.io?.engine?.transport?.name
        if (transportName) {
          logData.transport = transportName
        }

        if (description) {
          if (description instanceof Error) {
            logData.errorMessage = description.message
            logData.errorName = description.name
            logData.errorStack = description.stack
          } else {
            const { description: descriptionText, context } = description
            logData.description = descriptionText
            if (context) {
              // Safely serialize context to avoid JSON.stringify issues with non-serializable values
              try {
                logData.context = typeof context === 'object'
                  ? JSON.parse(JSON.stringify(context))
                  : context
              } catch {
                logData.context = String(context)
              }
            }
          }
        }

        logger.warn('websocket.connection.disconnect', logData)

        this.callbacks?.onDisconnect?.({ reason, socket, description })
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
        shipAnalyticsLog('funnel.ws.connect_failed', {
          appId,
          error: 'Reconnection attempts exhausted',
          reason: 'transport_error',
        })
        this.callbacks?.onReconnectFailed?.({ socket })
      },

      onError: (error: Error) => {
        const errorData: Record<string, unknown> = {
          appId,
          message: error.message,
          errorName: error.name,
          errorType: error.constructor.name,
          connectAttemptId: this.connectionPhases?.connectAttemptId,
        }

        // Capture Socket.IO specific error properties if they exist
        if ('type' in error && typeof error.type === 'string') {
          errorData.socketIoType = error.type
        }
        if ('description' in error && error.description) {
          errorData.description = error.description
        }
        if ('context' in error && error.context) {
          // Safely serialize context to avoid JSON.stringify issues
          try {
            errorData.context = typeof error.context === 'object'
              ? JSON.parse(JSON.stringify(error.context))
              : error.context
          } catch {
            errorData.context = String(error.context)
          }
        }
        if (error.stack) {
          errorData.errorStack = error.stack
        }

        logger.error('websocket.socket.error', errorData)
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

    // Old server doesn't support connect-then-auth: falls back to token-in-handshake
    if (message.includes('Missing or invalid Authorization')) {
      logger.info('websocket.auth.fallback_to_handshake', {
        appId,
        message: 'Server does not support connect-then-auth, falling back to token in handshake',
      })
      const token = this.cachedToken ?? await this.deps.fetchAgentToken(appId)
      if (token && appId === this.currentAppId) {
        this.cachedToken = token
        if (this.socket) {
          this.socket.removeAllListeners()
          this.socket.disconnect()
        }
        const previousSocketId = this.getStoredSocketId(appId)
        this.handshakeAuthMode = true
        this.createAndRegisterSocket({ appId, token, previousSocketId, isNew: true })
      } else {
        shipAnalyticsLog('funnel.ws.connect_failed', {
          appId,
          error: 'Failed to acquire authentication token for fallback',
          reason: 'token_failed',
        })
        this.callbacks?.onConnectionFailed?.(new Error('Failed to acquire authentication token for fallback'))
      }
      return
    }

    if (message.includes('JWT validation failed') && message.includes('Token expired')) {
      await this.handleTokenExpiration(appId)
      return
    }

    this.callbacks?.onConnectError?.(error)
  }

  private async handleTokenExpiration(appId: string): Promise<void> {
    // Reset phase state so stale data from the previous attempt doesn't leak
    this.connectionPhases = null
    this.connectAttemptStart = null

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

    // Keep cachedToken in sync so reconnect onConnect handler uses the fresh token
    this.cachedToken = newToken

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
