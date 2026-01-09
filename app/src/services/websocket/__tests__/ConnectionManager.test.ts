import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSharedSocket, setSharedSocket } from '@/lib/socketRegistry'
import type { ConnectionCallbacks } from '../ConnectionManager'
import { ConnectionManager } from '../ConnectionManager'

class MockSocket {
  id: string
  recovered = false
  io = { reconnection: vi.fn() }
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

  emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((handler) => handler(...args))
  }

  connect = vi.fn()
  disconnect = vi.fn()
  removeAllListeners = vi.fn(() => {
    this.handlers.clear()
  })

  trigger(event: string, ...args: any[]) {
    this.emit(event, ...args)
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
})
