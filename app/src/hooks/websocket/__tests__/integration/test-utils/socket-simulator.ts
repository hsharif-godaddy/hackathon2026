/**
 * Socket Simulator for Integration Tests
 *
 * Extends the existing mock socket pattern with server-side simulation capabilities.
 * Allows tests to simulate server → client events and assert on client → server emissions.
 */

import { vi } from 'vitest'

export interface ClientEmission {
  event: string
  data: unknown
}

export interface SocketSimulator {
  id: string
  connected: boolean
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
  io: { reconnection: ReturnType<typeof vi.fn> }
  volatile: { emit: ReturnType<typeof vi.fn> }

  // Server simulation methods
  serverEmit: (event: string, data: unknown, ack?: () => void) => void
  simulateConnect: () => void
  simulateDisconnect: (reason: string) => void
  simulateReconnect: (attempt: number) => void
  simulateReconnectAttempt: (attempt: number) => void
  /**
   * Simulates a token expiration error from the server.
   * Used to test token refresh flows in ConnectionManager.
   */
  simulateTokenExpired: () => void
  /**
   * Simulates a generic connect_error from the server.
   */
  simulateConnectError: (error: Error) => void

  // Assertion helpers
  getClientEmissions: () => ClientEmission[]
  wasEmitted: (event: string) => boolean
  getEmission: (event: string) => ClientEmission | undefined
  getEmissions: (event: string) => ClientEmission[]
  clearEmissions: () => void
}

let socketCounter = 0

export function createSocketSimulator(): SocketSimulator {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const clientEmissions: ClientEmission[] = []
  const socketId = `test-socket-${++socketCounter}`

  const socket: SocketSimulator = {
    id: socketId,
    connected: false,

    // Client → Server (tracked for assertions)
    emit: vi.fn((event: string, data: unknown) => {
      clientEmissions.push({ event, data })
    }),

    // Server → Client event registration
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return socket
    }),

    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const onceWrapper = (...args: unknown[]) => {
        socket.off(event, onceWrapper)
        handler(...args)
      }
      return socket.on(event, onceWrapper)
    }),

    off: vi.fn((event: string, handler?: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) {return socket}
      if (handler) {
        const list = handlers.get(event) ?? []
        handlers.set(
          event,
          list.filter((h) => h !== handler)
        )
      } else {
        handlers.delete(event)
      }
      return socket
    }),

    disconnect: vi.fn(() => {
      socket.connected = false
      return socket
    }),

    connect: vi.fn(() => {
      socket.connected = true
      // Trigger connect event asynchronously like real Socket.IO
      setTimeout(() => {
        handlers.get('connect')?.forEach((h) => h())
      }, 0)
      return socket
    }),

    removeAllListeners: vi.fn(() => {
      handlers.clear()
      return socket
    }),

    io: {
      reconnection: vi.fn(),
    },

    volatile: {
      emit: vi.fn((event: string, data: unknown) => {
        clientEmissions.push({ event, data })
      }),
    },

    // Server simulation: send event to client handlers
    serverEmit(event: string, data: unknown, ack?: () => void) {
      if (event === 'message') {
        // For 'message' events, just dispatch directly to message handlers
        handlers.get('message')?.forEach((h) => h(data, ack))
      } else {
        // For other events (e.g., 'connect', 'disconnect', 'status')
        // dispatch to specific handlers first
        handlers.get(event)?.forEach((h) => h(data, ack))
      }
    },

    // Connection lifecycle simulation
    simulateConnect() {
      socket.connected = true
      handlers.get('connect')?.forEach((h) => h())
    },

    simulateDisconnect(reason: string) {
      socket.connected = false
      handlers.get('disconnect')?.forEach((h) => h(reason))
    },

    simulateReconnect(attempt: number) {
      socket.connected = true
      handlers.get('reconnect')?.forEach((h) => h(attempt))
    },

    simulateReconnectAttempt(attempt: number) {
      handlers.get('reconnect_attempt')?.forEach((h) => h(attempt))
    },

    simulateTokenExpired() {
      const error = new Error('JWT validation failed: Token expired')
      handlers.get('connect_error')?.forEach((h) => h(error))
    },

    simulateConnectError(error: Error) {
      handlers.get('connect_error')?.forEach((h) => h(error))
    },

    // Assertion helpers
    getClientEmissions: () => [...clientEmissions],

    wasEmitted: (event: string) => clientEmissions.some((e) => e.event === event),

    getEmission: (event: string) => clientEmissions.find((e) => e.event === event),

    getEmissions: (event: string) => clientEmissions.filter((e) => e.event === event),

    clearEmissions() {
      clientEmissions.length = 0
    },
  }

  return socket
}

/**
 * Helper to trigger a message event on the socket (simulates server sending a message)
 */
export async function triggerMessage(
  socket: SocketSimulator,
  payload: { type: string; content?: string; data?: unknown }
) {
  socket.serverEmit('message', payload)
}
