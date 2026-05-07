import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { createSSERoutes } from '../routes.js'
import { EventStreamRegistry } from '../EventStreamRegistry.js'

// Mock BYPASS_SITE_IDS
vi.mock('../../../services/features.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    BYPASS_SITE_IDS: ['bypass-site', 'local-dev-site', 'default-site', 'mock-site-id']
  }
})

describe('SSE integration', () => {
  let server: Server
  let port: number
  let registry: EventStreamRegistry

  const mockLifecycle = {
    create: vi.fn().mockImplementation((scope: { appId: string }, agentId: string) =>
      Promise.resolve({ id: 'conv_new', appId: scope.appId, agentId })
    ),
    getOrCreateForApp: vi.fn().mockImplementation((scope: { appId: string }, agentId: string) =>
      Promise.resolve({ conversation: { id: 'conv_new', appId: scope.appId, agentId }, isNew: true })
    ),
    getById: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, appId: 'abcdefghij', agentId: 'develop' })
    ),
    getLatestForApp: vi.fn().mockResolvedValue(null),
  }
  const mockMessages = {
    getMessagesPaginated: vi.fn().mockResolvedValue({
      messages: [],
      hasMore: false,
      nextCursor: null,
      total: 0,
    }),
  }

  beforeEach(async () => {
    registry = new EventStreamRegistry()
    const app = express()
    app.use(express.json())
    app.use('/api/conversations', createSSERoutes({
      registry,
      authenticate: (req: any, _res, next) => {
        req.agentContext = { siteId: req.params.appId ?? 'abcdefghij' }
        next()
      },
      getEventChannel: () => null,
      resolveAgent: () => 'develop',
      getStateManager: () => null,
      lifecycle: mockLifecycle as any,
      messages: mockMessages as any,
    }))

    server = createServer(app)
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    })
  })

  it('establishes SSE connection and receives retry directive', async () => {
    const controller = new AbortController()

    const response = await fetch(`http://localhost:${port}/api/conversations/abcdefghij/conv_1/stream`, {
      signal: controller.signal,
      headers: { 'Accept': 'text/event-stream' }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('retry: 1000')

    controller.abort()
  })

  it('registers and unregisters connections by conversationId', async () => {
    const controller = new AbortController()

    const response = await fetch(`http://localhost:${port}/api/conversations/abcdefghij/conv_1/stream`, {
      signal: controller.signal,
      headers: { 'Accept': 'text/event-stream' }
    })

    const reader = response.body!.getReader()
    await reader.read()

    expect(registry.hasConnections('conv_1')).toBe(true)

    controller.abort()

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(registry.hasConnections('conv_1')).toBe(false)
  })

  it('POST /:appId/:conversationId/messages returns 503 when no executionService is wired', async () => {
    const response = await fetch(`http://localhost:${port}/api/conversations/abcdefghij/conv_1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello' })
    })

    expect(response.status).toBe(503)
    const data = await response.json()
    expect(data.error).toBe('Message execution not available')
  })

  it('POST /:appId/:conversationId/stop returns 202', async () => {
    const response = await fetch(`http://localhost:${port}/api/conversations/abcdefghij/conv_1/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    expect(response.status).toBe(202)
  })

  it('POST /:appId creates a new conversation', async () => {
    const response = await fetch(`http://localhost:${port}/api/conversations/abcdefghij`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.conversationId).toBe('conv_new')
    expect(data.isNew).toBe(true)
  })
})
