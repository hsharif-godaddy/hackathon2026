import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shipAnalyticsLog } from '@/lib/logging'
import { getSharedSocket, setSharedSocket } from '@/lib/socketRegistry'

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))
import type { ConnectionCallbacks } from '../ConnectionManager'
import { ConnectionManager } from '../ConnectionManager'

class MockSocket {
  id: string
  recovered = false
  io = { reconnection: vi.fn() }
  sentEvents: Array<{ event: string; args: any[] }> = []
  private handlers = new Map<string, Array<(...args: any[]) => void>>()

  constructor(id: string) {
    this.id = id
  }

  on(event: string, handler: (...args: any[]) => void) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
    return this
  }

  off(event: string, handler: (...args: any[]) => void) {
    const handlers = this.handlers.get(event) ?? []
    this.handlers.set(event, handlers.filter((existing) => existing !== handler))
    return this
  }

  removeListener(event: string, handler: (...args: any[]) => void) {
    return this.off(event, handler)
  }

  emit(event: string, ...args: any[]) {
    this.sentEvents.push({ event, args })
    this.handlers.get(event)?.forEach((handler) => handler(...args))
  }

  connect = vi.fn()
  disconnect = vi.fn()
  removeAllListeners = vi.fn(() => {
    this.handlers.clear()
  })

  trigger(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((handler) => handler(...args))
  }
}

const createStorage = () => {
  const backing = new Map<string, string>()
  return {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value)
    },
    removeItem: (key: string) => {
      backing.delete(key)
    },
  }
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setSharedSocket(null)
  })

  const createManager = (overrides: Partial<ConstructorParameters<typeof ConnectionManager>[0]> = {}) => {
    const storage = createStorage()
    const fetchAgentToken = vi.fn().mockResolvedValue('token-123')
    const getConfigForSite = vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:4000' })
    let socketCounter = 0
    const sockets: MockSocket[] = []
    const createSocket = vi.fn().mockImplementation(() => {
      const socket = new MockSocket(`socket-${socketCounter++}`)
      sockets.push(socket)
      return socket
    })

    const manager = new ConnectionManager({
      delayMs: 0,
      storage,
      fetchAgentToken,
      getConfigForSite,
      createSocket,
      ...overrides,
    })

    return { manager, storage, fetchAgentToken, getConfigForSite, createSocket, sockets }
  }

  it('creates a socket and notifies callbacks on connect', async () => {
    const { manager, createSocket, sockets } = createManager()

    const callbacks: ConnectionCallbacks = {
      onSocketReady: vi.fn(),
      onConnect: vi.fn(),
    }

    await manager.connect('app-123', callbacks)

    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(callbacks.onSocketReady).toHaveBeenCalledWith(expect.any(Object), { isNew: true })

    sockets[0].trigger('connect')

    expect(callbacks.onConnect).toHaveBeenCalledWith({
      socket: sockets[0] as any,
      recovered: false,
    })
  })

  it('reuses shared socket when available for same app', async () => {
    const sharedSocket = new MockSocket('shared-socket')
    // Set up the appId in the socket's auth so it matches the connect call
    ;(sharedSocket as any).io = { opts: { auth: { appId: 'app-abc' } } }
    setSharedSocket(sharedSocket as unknown as any)

    const { manager, createSocket } = createManager()

    const callbacks: ConnectionCallbacks = {
      onSocketReady: vi.fn(),
    }

    await manager.connect('app-abc', callbacks)

    expect(createSocket).not.toHaveBeenCalled()
    expect(callbacks.onSocketReady).toHaveBeenCalledWith(sharedSocket, { isNew: false })
  })

  it('does not reuse shared socket for different app', async () => {
    const sharedSocket = new MockSocket('shared-socket')
    // Shared socket is for a different app
    ;(sharedSocket as any).io = { opts: { auth: { appId: 'app-old' } } }
    setSharedSocket(sharedSocket as unknown as any)

    const { manager, createSocket, sockets } = createManager()

    const callbacks: ConnectionCallbacks = {
      onSocketReady: vi.fn(),
    }

    await manager.connect('app-new', callbacks)

    // Should create a new socket since appId doesn't match
    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(callbacks.onSocketReady).toHaveBeenCalledWith(sockets[0], { isNew: true })
    expect(sharedSocket.disconnect).toHaveBeenCalled()
  })

  it('refreshes token when expiration error occurs', async () => {
    const fetchAgentToken = vi.fn().mockResolvedValueOnce('token-old').mockResolvedValueOnce('token-new')
    const { manager, createSocket, sockets } = createManager({ fetchAgentToken })

    const callbacks: ConnectionCallbacks = {
      onSocketReady: vi.fn(),
      onConnectionFailed: vi.fn(),
    }

    await manager.connect('app-refresh', callbacks)

    expect(createSocket).toHaveBeenCalledTimes(1)
    const firstSocket = sockets[0]

    firstSocket.trigger('connect_error', new Error('JWT validation failed: Token expired'))

    await flushPromises()

    expect(fetchAgentToken).toHaveBeenCalledTimes(2)
    expect(createSocket).toHaveBeenCalledTimes(2)
    expect(callbacks.onSocketReady).toHaveBeenCalledTimes(2)
    expect(callbacks.onConnectionFailed).not.toHaveBeenCalled()
  })

  it('notifies onConnectError for non-token failures', async () => {
    const { manager, sockets } = createManager()

    const callbacks: ConnectionCallbacks = {
      onConnectError: vi.fn(),
      onSocketReady: vi.fn(),
    }

    await manager.connect('app-failure', callbacks)

    sockets[0].trigger('connect_error', new Error('ECONNREFUSED'))

    expect(callbacks.onConnectError).toHaveBeenCalledWith(expect.objectContaining({ message: 'ECONNREFUSED' }))
  })

  it('emits connectionFailed when token refresh cannot recover', async () => {
    const fetchAgentToken = vi.fn().mockResolvedValue(null)
    const { manager } = createManager({ fetchAgentToken })

    const callbacks: ConnectionCallbacks = {
      onConnectionFailed: vi.fn(),
    }

    await manager.connect('app-error', callbacks)

    expect(callbacks.onConnectionFailed).toHaveBeenCalled()
  })

  it('disconnects managed socket and clears shared reference', async () => {
    const { manager, sockets } = createManager()

    await manager.connect('app-clean', {})

    expect(getSharedSocket()).toBe(sockets[0] as unknown as any)

    manager.disconnect()

    expect(sockets[0].disconnect).toHaveBeenCalled()
    expect(getSharedSocket()).toBeNull()
  })

  it('does not let a superseded initializeSocket finally clear a newer connectPromise', async () => {
    let releaseFirstConfig: (value: { baseUrl: string }) => void
    const firstConfigHold = new Promise<{ baseUrl: string }>((resolve) => {
      releaseFirstConfig = resolve
    })
    let releaseNextToken: () => void
    const nextTokenHold = new Promise<void>((resolve) => {
      releaseNextToken = resolve
    })
    const fetchAgentToken = vi.fn().mockImplementation((siteId: string) => {
      if (siteId === 'app-next') {
        return nextTokenHold.then(() => 'token-for-next')
      }
      return Promise.resolve('token-default')
    })
    const configMock = vi
      .fn()
      .mockReturnValueOnce(firstConfigHold)
      .mockResolvedValue({ baseUrl: 'http://localhost:4000' })

    const { manager, createSocket } = createManager({
      delayMs: 0,
      getConfigForSite: configMock,
      fetchAgentToken,
    })

    const firstConnect = manager.connect('app-stale', { onSocketReady: vi.fn() })

    await flushPromises()

    manager.disconnect()

    const secondConnect = manager.connect('app-next', { onSocketReady: vi.fn() })

    await flushPromises()

    expect(createSocket).toHaveBeenCalledTimes(1)

    releaseFirstConfig!({ baseUrl: 'http://localhost:4000' })

    await flushPromises()

    void manager.connect('app-intruder', { onSocketReady: vi.fn() })

    await flushPromises()

    expect(createSocket).toHaveBeenCalledTimes(1)

    releaseNextToken!()

    await Promise.all([firstConnect, secondConnect])

    expect(configMock).toHaveBeenCalledWith('app-next')

    await manager.connect('app-third', { onSocketReady: vi.fn() })

    expect(configMock).toHaveBeenCalledWith('app-third')
  })

  it('forwards reconnection lifecycle events', async () => {
    const { manager, sockets } = createManager()

    const callbacks: ConnectionCallbacks = {
      onSocketReady: vi.fn(),
      onReconnectAttempt: vi.fn(),
      onReconnect: vi.fn(),
      onReconnectError: vi.fn(),
      onReconnectFailed: vi.fn(),
    }

    await manager.connect('app-reconnect', callbacks)

    const socket = sockets[0]
    socket.trigger('reconnect_attempt', 2)
    socket.trigger('reconnect', 3)
    socket.trigger('reconnect_error', new Error('boom'))
    socket.trigger('reconnect_failed')

    expect(callbacks.onReconnectAttempt).toHaveBeenCalledWith({ socket, attempt: 2 })
    expect(callbacks.onReconnect).toHaveBeenCalledWith({ socket, attempt: 3 })
    expect(callbacks.onReconnectError).toHaveBeenCalledWith({ socket, error: expect.objectContaining({ message: 'boom' }) })
    expect(callbacks.onReconnectFailed).toHaveBeenCalledWith({ socket })
  })

  it('invokes connectionFailed after exceeding token refresh attempts', async () => {
    const fetchAgentToken = vi.fn().mockResolvedValue('token-refresh')
    const { manager, sockets } = createManager({ fetchAgentToken })

    const callbacks: ConnectionCallbacks = {
      onConnectionFailed: vi.fn(),
    }

    await manager.connect('app-max-refresh', callbacks)

    const tokenError = new Error('JWT validation failed: Token expired')

    // 8 connect_error events trigger MAX_TOKEN_REFRESH_ATTEMPTS guard
    for (let index = 0; index < 8; index++) {
      const socket = sockets[index]
      socket.trigger('connect_error', tokenError)
      await flushPromises()
    }

    expect(callbacks.onConnectionFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to establish connection after multiple token refresh attempts',
      })
    )
  })

  describe('connect-then-auth', () => {
    afterEach(() => {
      // Safety net: ensure fake timers don't leak between tests
      vi.useRealTimers()
    })

    it('authenticateSocket emits authenticate event after connect', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onSocketReady: vi.fn(),
        onConnect: vi.fn(),
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Verify authenticate event was sent to server
      const authEmit = socket.sentEvents.find(e => e.event === 'authenticate')
      expect(authEmit).toBeDefined()
      expect(authEmit!.args[0]).toEqual({ token: 'token-123' })
    })

    it('authenticateSuccess triggers onAuthenticated', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Simulate server responding with success
      socket.trigger('authenticateSuccess', { socketId: 'socket-0' })

      expect(callbacks.onAuthenticated).toHaveBeenCalledWith({ socket: socket as any })
    })

    it('authenticateError triggers onAuthFailed', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthFailed: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Simulate server responding with error
      socket.trigger('authenticateError', { error: 'Invalid token' })

      expect(callbacks.onAuthFailed).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid token' })
      )
    })

    it('auth timeout fires onAuthFailed', async () => {
      vi.useFakeTimers()

      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthFailed: vi.fn(),
      }

      const connectPromise = manager.connect('app-auth', callbacks)
      // Advance past the delayMs=0 init timer and flush microtasks
      await vi.advanceTimersByTimeAsync(1)
      await connectPromise

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      expect(callbacks.onAuthFailed).not.toHaveBeenCalled()

      // Advance past auth timeout (30s)
      vi.advanceTimersByTime(30_000)

      expect(callbacks.onAuthFailed).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Authentication timed out' })
      )

      vi.useRealTimers()
    })

    it('stale appId guard prevents callback invocation', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Disconnect (changes currentAppId to null)
      manager.disconnect()

      // Simulate late auth success
      socket.trigger('authenticateSuccess', { socketId: 'socket-0' })

      expect(callbacks.onAuthenticated).not.toHaveBeenCalled()
    })

    it('reconnect with handshake token skips authenticateSocket', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      // Simulate a socket that was created with a token in the handshake
      // (handshakeAuthMode fallback or handleTokenExpiration), then auto-reconnects.
      // Socket.IO preserves the auth object across reconnects.
      ;(socket as any).auth = { token: 'handshake-token', appId: 'app-auth' }
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Should call onAuthenticated directly — server already validated via io.use()
      expect(callbacks.onAuthenticated).toHaveBeenCalledWith({ socket: socket as any })

      // Should NOT emit authenticate event (would timeout on old servers)
      const authEmit = socket.sentEvents.find(e => e.event === 'authenticate')
      expect(authEmit).toBeUndefined()
    })

    it('handshakeAuthMode skips authenticateSocket and calls onAuthenticated directly', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-fallback', callbacks)

      const firstSocket = sockets[0]

      // Trigger the fallback path by simulating Missing Authorization error
      firstSocket.trigger('connect_error', new Error('Missing or invalid Authorization'))
      await flushPromises()

      // A second socket should be created with handshakeAuthMode
      const secondSocket = sockets[1]
      expect(secondSocket).toBeDefined()
      ;(secondSocket as any).connected = true
      secondSocket.trigger('connect')

      // Should call onAuthenticated directly without emitting authenticate
      expect(callbacks.onAuthenticated).toHaveBeenCalledWith({ socket: secondSocket as any })

      // Verify authenticate was NOT emitted on the second socket
      const authEmit = secondSocket.sentEvents?.find((e: any) => e.event === 'authenticate')
      expect(authEmit).toBeUndefined()
    })

    it('auth listeners are cleaned up after auth completes', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Complete auth
      socket.trigger('authenticateSuccess', { socketId: 'socket-0' })

      // Reset mock
      ;(callbacks.onAuthenticated as any).mockClear()

      // Trigger again — should not invoke callback (listener removed)
      socket.trigger('authenticateSuccess', { socketId: 'socket-0' })

      expect(callbacks.onAuthenticated).not.toHaveBeenCalled()
    })

    it('token is NOT stored in socket.auth after auth success (prevents reconnect leak)', async () => {
      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthenticated: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Complete auth
      socket.trigger('authenticateSuccess', { socketId: 'socket-0' })

      // Verify token was NOT stored in socket.auth — storing it would cause
      // Socket.IO auto-reconnect to send a stale token in the handshake,
      // bypassing connect-then-auth and leaking recovery data before auth.
      expect((socket as any).auth?.token).toBeUndefined()
    })

    it('authTimeoutId is cleared when socket disconnects during auth', async () => {
      vi.useFakeTimers()

      const { manager, sockets } = createManager()

      const callbacks: ConnectionCallbacks = {
        onAuthFailed: vi.fn(),
        onDisconnect: vi.fn(),
      }

      const connectPromise = manager.connect('app-auth', callbacks)
      await vi.advanceTimersByTimeAsync(1)
      await connectPromise

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      expect((manager as any).authTimeoutId).not.toBeNull()

      // Disconnect before auth completes
      socket.trigger('disconnect', 'transport close')

      expect((manager as any).authTimeoutId).toBeNull()
      expect(callbacks.onDisconnect).toHaveBeenCalled()

      // Advancing past auth timeout should NOT trigger onAuthFailed (timer cleared)
      vi.advanceTimersByTime(30_000)
      expect(callbacks.onAuthFailed).not.toHaveBeenCalled()
    })

    it('cachedToken is cleared on auth failure', async () => {
      const fetchAgentToken = vi.fn().mockResolvedValue('token-123')
      const { manager, sockets } = createManager({ fetchAgentToken })

      const callbacks: ConnectionCallbacks = {
        onAuthFailed: vi.fn(),
      }

      await manager.connect('app-auth', callbacks)

      const socket = sockets[0]
      ;(socket as any).connected = true
      socket.trigger('connect')

      // Simulate auth error
      socket.trigger('authenticateError', { error: 'Bad token' })

      // Access private field for verification (test-only)
      expect((manager as any).cachedToken).toBeNull()
    })
  })

  describe('funnel analytics events', () => {
    beforeEach(() => {
      vi.mocked(shipAnalyticsLog).mockClear()
    })

    describe('funnel.ws.connected', () => {
      it('fires on authenticateSuccess (connect-then-auth)', async () => {
        const { manager, sockets } = createManager()

        const callbacks: ConnectionCallbacks = {
          onAuthenticated: vi.fn(),
        }

        await manager.connect('app-funnel', callbacks)

        const socket = sockets[0]
        ;(socket as any).connected = true
        socket.trigger('connect')
        socket.trigger('authenticateSuccess', { socketId: 'socket-0' })

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connected', expect.objectContaining({
          appId: 'app-funnel',
        }))
      })

      it('fires on handshakeAuthMode path', async () => {
        const { manager, sockets } = createManager()

        const callbacks: ConnectionCallbacks = {
          onAuthenticated: vi.fn(),
        }

        await manager.connect('app-fallback-funnel', callbacks)

        // Trigger fallback path
        sockets[0].trigger('connect_error', new Error('Missing or invalid Authorization'))
        await flushPromises()

        const secondSocket = sockets[1]
        ;(secondSocket as any).connected = true
        secondSocket.trigger('connect')

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connected', expect.objectContaining({
          appId: 'app-fallback-funnel',
        }))
      })

      it('fires when socket reconnects with handshake token', async () => {
        const { manager, sockets } = createManager()

        const callbacks: ConnectionCallbacks = {
          onAuthenticated: vi.fn(),
        }

        await manager.connect('app-reconnect-funnel', callbacks)

        const socket = sockets[0]
        ;(socket as any).auth = { token: 'handshake-token', appId: 'app-reconnect-funnel' }
        ;(socket as any).connected = true
        socket.trigger('connect')

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connected', expect.objectContaining({
          appId: 'app-reconnect-funnel',
        }))
      })
    })

    describe('funnel.ws.connect_failed', () => {
      it('fires on authenticateError (auth_rejected)', async () => {
        const { manager, sockets } = createManager()

        const callbacks: ConnectionCallbacks = {
          onAuthFailed: vi.fn(),
        }

        await manager.connect('app-auth-fail', callbacks)

        const socket = sockets[0]
        ;(socket as any).connected = true
        socket.trigger('connect')
        socket.trigger('authenticateError', { error: 'Invalid token' })

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connect_failed', {
          appId: 'app-auth-fail',
          error: 'Invalid token',
          reason: 'auth_rejected',
        })
      })

      it('fires when token is null (token_failed)', async () => {
        const fetchAgentToken = vi.fn().mockResolvedValue(null)
        const { manager } = createManager({ fetchAgentToken })

        const callbacks: ConnectionCallbacks = {
          onConnectionFailed: vi.fn(),
        }

        await manager.connect('app-no-token', callbacks)

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connect_failed', {
          appId: 'app-no-token',
          error: 'Failed to acquire authentication token',
          reason: 'token_failed',
        })
      })

      it('fires on reconnect_failed (transport_error)', async () => {
        const { manager, sockets } = createManager()

        const callbacks: ConnectionCallbacks = {
          onReconnectFailed: vi.fn(),
        }

        await manager.connect('app-transport-fail', callbacks)

        sockets[0].trigger('reconnect_failed')

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connect_failed', {
          appId: 'app-transport-fail',
          error: 'Reconnection attempts exhausted',
          reason: 'transport_error',
        })
      })

      it('fires on handshake fallback token failure (token_failed)', async () => {
        const fetchAgentToken = vi.fn()
          .mockResolvedValueOnce('token-initial')  // initial connect succeeds
          .mockResolvedValueOnce(null)              // fallback fetch fails
        const { manager, sockets } = createManager({ fetchAgentToken })

        const callbacks: ConnectionCallbacks = {
          onConnectionFailed: vi.fn(),
        }

        await manager.connect('app-fallback-fail', callbacks)

        // Clear cachedToken so the fallback path calls fetchAgentToken (which returns null)
        ;(manager as any).cachedToken = null

        vi.mocked(shipAnalyticsLog).mockClear()

        // Trigger handshake fallback path
        sockets[0].trigger('connect_error', new Error('Missing or invalid Authorization'))
        await flushPromises()

        expect(shipAnalyticsLog).toHaveBeenCalledWith('funnel.ws.connect_failed', {
          appId: 'app-fallback-fail',
          error: 'Failed to acquire authentication token for fallback',
          reason: 'token_failed',
        })
      })
    })
  })
})
