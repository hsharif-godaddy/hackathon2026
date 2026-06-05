import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Server as HTTPServer } from 'http'
import { WebSocketServer } from '../experimental-websocket-server.js'

vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(function () { return {
    on: vi.fn(),
    close: vi.fn(),
  }; }),
}))

vi.mock('@signals/otel-sdk', () => ({
  createTraceContext: vi.fn().mockReturnValue(Symbol('trace-context')),
}))

const mockAgent = {
  getName: () => 'test-agent',
  streamGenerate: vi.fn(),
}

describe('getActiveAgent', () => {
  let httpServer: HTTPServer
  let agentRouter: ReturnType<typeof vi.fn>
  let stateManager: {
    getCurrentAgent: ReturnType<typeof vi.fn>
    getSessionMetadata: ReturnType<typeof vi.fn>
    clearSession: ReturnType<typeof vi.fn>
    switchAgent: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    httpServer = new HTTPServer()
    agentRouter = vi.fn()
    stateManager = {
      getCurrentAgent: vi.fn(),
      getSessionMetadata: vi.fn(),
      clearSession: vi.fn(),
      switchAgent: vi.fn(),
    }
  })

  function createServer(): WebSocketServer {
    return new WebSocketServer(httpServer, {
      agents: { get: vi.fn().mockReturnValue(mockAgent), list: vi.fn().mockReturnValue(['develop']) } as any,
      agentRouter,
      stateManager: stateManager as any,
      defaultAgent: 'develop',
    })
  }

  function callGetActiveAgent(server: WebSocketServer, socketId: string, data: any): Promise<string | undefined> {
    return (server as any).getActiveAgent(socketId, data)
  }

  const socketId = 'socket-1'
  const messageData = { context: { metadata: { appId: 'app-123' } } }

  it('returns routedAgent when router upgrades from session agent (same app)', async () => {
    agentRouter.mockResolvedValue('develop-experimental')
    stateManager.getCurrentAgent.mockReturnValue('develop')
    stateManager.getSessionMetadata.mockReturnValue({ appId: 'app-123' })

    const server = createServer()
    const result = await callGetActiveAgent(server, socketId, messageData)

    expect(result).toBe('develop-experimental')
  })

  it('returns routedAgent when router returns same agent as session', async () => {
    agentRouter.mockResolvedValue('develop')
    stateManager.getCurrentAgent.mockReturnValue('develop')
    stateManager.getSessionMetadata.mockReturnValue({ appId: 'app-123' })

    const server = createServer()
    const result = await callGetActiveAgent(server, socketId, messageData)

    expect(result).toBe('develop')
  })

  it('returns session agent when router returns undefined', async () => {
    agentRouter.mockResolvedValue(undefined)
    stateManager.getCurrentAgent.mockReturnValue('develop')
    stateManager.getSessionMetadata.mockReturnValue({ appId: 'app-123' })

    const server = createServer()
    const result = await callGetActiveAgent(server, socketId, messageData)

    expect(result).toBe('develop')
  })

  it('clears session and uses router when app changes', async () => {
    agentRouter.mockResolvedValue('develop-experimental')
    stateManager.getCurrentAgent.mockReturnValue('develop')
    stateManager.getSessionMetadata.mockReturnValue({ appId: 'old-app' })

    const server = createServer()
    const result = await callGetActiveAgent(server, socketId, messageData)

    expect(stateManager.clearSession).toHaveBeenCalledWith(socketId)
    expect(result).toBe('develop-experimental')
  })

  it('returns router result when no session agent exists', async () => {
    agentRouter.mockResolvedValue('initial')
    stateManager.getCurrentAgent.mockReturnValue(undefined)

    const server = createServer()
    const result = await callGetActiveAgent(server, socketId, messageData)

    expect(result).toBe('initial')
  })

  it('ignores a client-sent data.agentId/agentName and falls back to the default agent', async () => {
    // The router owns selection; a stale/forged client field must not steer routing.
    agentRouter.mockResolvedValue(undefined)
    stateManager.getCurrentAgent.mockReturnValue(undefined)

    const server = createServer()
    const result = await callGetActiveAgent(server, socketId, {
      ...messageData,
      agentId: 'marketing',
      agentName: 'marketing',
    })

    expect(result).toBe('develop')
  })
})
