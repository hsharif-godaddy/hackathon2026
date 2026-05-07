import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSSERoutes } from '../routes.js'
import { EventStreamRegistry } from '../EventStreamRegistry.js'

vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    grantSessionManager: { setGrants: vi.fn() },
  }
})

// Mock BYPASS_SITE_IDS
vi.mock('../../../services/features.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    BYPASS_SITE_IDS: ['bypass-site', 'local-dev-site', 'default-site', 'mock-site-id']
  }
})

const mockClientActionServices = new Map<string, any>()
vi.mock('../../ai-lib-websocket-server.js', () => ({
  getSSEAgentFactory: vi.fn().mockReturnValue(null),
  getClientActionService: vi.fn((key: string) => mockClientActionServices.get(key) ?? null),
}))

const mockBudgetPreCheck = vi.fn()
vi.mock('../../budget-pre-check.js', () => ({
  performBudgetPreCheck: (...args: any[]) => mockBudgetPreCheck(...args),
}))

const EXPECTED_SSE_OPEN_PADDING_MIN_BYTES = 4096

function createMockDeps() {
  return {
    registry: new EventStreamRegistry(),
    authenticate: vi.fn((req: any, _res: any, next: any) => {
      req.agentContext = { siteId: req.params.appId ?? 'abcdefghij' }
      next()
    }),
    getEventChannel: vi.fn().mockReturnValue({
      getEventsSince: vi.fn().mockReturnValue([]),
      getMetadata: vi.fn().mockReturnValue(null),
    }),
    resolveAgent: vi.fn().mockResolvedValue('develop'),
    getStateManager: vi.fn().mockReturnValue(null),
    lifecycle: {
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
      updateAgentId: vi.fn().mockResolvedValue(undefined),
    },
    messages: {
      getMessagesPaginated: vi.fn().mockResolvedValue({
        messages: [],
        hasMore: false,
        nextCursor: null,
        total: 0,
      }),
      getMessageCount: vi.fn().mockResolvedValue(1),
    },
  }
}

describe('SSE routes', () => {
  let app: express.Express
  let deps: ReturnType<typeof createMockDeps>

  beforeEach(() => {
    mockClientActionServices.clear()
    mockBudgetPreCheck.mockReset().mockResolvedValue(null)
    app = express()
    app.use(express.json())
    deps = createMockDeps()
    app.use('/api/conversations', createSSERoutes(deps as any))
  })

  describe('POST /api/conversations/:appId', () => {
    it('creates a new conversation and returns conversationId', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij')
        .send({ agentId: 'develop' })

      expect(res.status).toBe(200)
      expect(res.body.conversationId).toBe('conv_new')
      expect(res.body.isNew).toBe(true)
    })

    it('calls resolveAgent with provided agentId and templateId', async () => {
      await request(app)
        .post('/api/conversations/abcdefghij')
        .send({ agentId: 'marketing', templateId: 'v8' })

      expect(deps.resolveAgent).toHaveBeenCalledWith(expect.objectContaining({ appId: 'abcdefghij', agentId: 'marketing', templateId: 'v8' }))
    })
  })

  describe('GET /api/conversations/:appId/:conversationId/stream', () => {
    it('returns 200 with text/event-stream content type', async () => {
      const res = await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .buffer(false)
        .parse((res, callback) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          setTimeout(() => {
            res.destroy()
            callback(null, data)
          }, 100)
        })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')
      expect(res.headers['cache-control']).toContain('no-cache')
      expect(res.headers['connection']).toBe('keep-alive')
    })

    it('sends opening padding and retry directive', async () => {
      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .buffer(false)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      const openingFrameEnd = capturedData.indexOf('\n\n')
      const openingFrame = capturedData.slice(0, openingFrameEnd)

      expect(openingFrameEnd).toBeGreaterThan(0)
      expect(openingFrame.startsWith(': open ')).toBe(true)
      expect(openingFrame.slice(': open '.length).length).toBeGreaterThanOrEqual(EXPECTED_SSE_OPEN_PADDING_MIN_BYTES)
      expect(capturedData.slice(openingFrameEnd + 2)).toContain('retry: 1000')
    })

    it('sends initialize event with serverConfig (no connectionId)', async () => {
      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .buffer(false)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: initialize')
      expect(capturedData).toContain('serverConfig')
      expect(capturedData).not.toContain('connectionId')
    })

    it('replays missed events on reconnect', async () => {
      const mockEvents = [
        { id: 'e1', type: 'text_delta', sequence: 42, conversationId: 'conv_1', content: 'hello', data: {} },
        { id: 'e2', type: 'text_delta', sequence: 43, conversationId: 'conv_1', content: 'world', data: {} },
      ]
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue(mockEvents),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: ['msg_1'] }),
      })

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '41')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('id: 42\nevent: text_delta')
      expect(capturedData).toContain('id: 43\nevent: text_delta')
      expect(capturedData).toContain('event: replay_complete')
      expect(capturedData).toContain('"replayedCount":2')
      // streamCompleted tells the client whether the stream ended mid-turn
      // (reconnect into a live turn) vs. already finished. No `complete`
      // event in the buffer means streamCompleted: false.
      expect(capturedData).toContain('event: recovery_status')
      expect(capturedData).toContain('"bufferedCount":2')
      expect(capturedData).toContain('"bufferedEventCount":2')
      expect(capturedData).toContain('"streamCompleted":false')
      expect(deps.getEventChannel().getEventsSince).toHaveBeenCalledWith('conv_1', 41)
    })

    it('sets recovery_status streamCompleted=true when no messages are pending', async () => {
      const mockEvents = [
        { id: 'e1', type: 'text_delta', sequence: 42, conversationId: 'conv_1', content: 'done', data: {} },
      ]
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue(mockEvents),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: [] }),
      })

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '41')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('"streamCompleted":true')
    })

    it('emits stream_error when reconnect cannot recover a lost active stream', async () => {
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue([]),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: ['msg_1'] }),
      })
      ;(deps as any).executionService = {
        subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(false),
      }

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '69')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: recovery_status')
      expect(capturedData).toContain('"streamCompleted":false')
      expect(capturedData).toContain('event: replay_complete')
      expect(capturedData).toContain('"replayedCount":0')
      expect(capturedData).toContain('event: stream_error')
      expect(capturedData).toContain('"errorType":"STREAM_RECOVERY_LOST"')
      expect(capturedData).toContain('"reason":"stream_lost_after_restart"')
      expect(capturedData).toContain('"recoverable":true')
      expect(capturedData.indexOf('event: stream_error')).toBeLessThan(capturedData.indexOf('event: initialize'))
      expect(capturedData).toContain('event: initialize')
      expect((deps as any).executionService.subscribeStream).toHaveBeenCalled()
    })

    it('does not emit stream_error when reconnect can attach to an active stream', async () => {
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue([]),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: ['msg_1'] }),
      })
      ;(deps as any).executionService = {
        subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(true),
      }

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '69')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: recovery_status')
      expect(capturedData).toContain('"streamCompleted":false')
      expect(capturedData).toContain('event: replay_complete')
      expect(capturedData).toContain('"replayedCount":0')
      expect(capturedData).not.toContain('event: stream_error')
      expect((deps as any).executionService.subscribeStream).toHaveBeenCalled()
    })

    it('does not emit stream_error when stream is complete and replay buffer is empty', async () => {
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue([]),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: [] }),
      })
      ;(deps as any).executionService = {
        subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(false),
      }

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '69')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: recovery_status')
      expect(capturedData).toContain('"hasBufferedEvents":false')
      expect(capturedData).toContain('"streamCompleted":true')
      expect(capturedData).toContain('event: replay_complete')
      expect(capturedData).toContain('"replayedCount":0')
      expect(capturedData).not.toContain('event: stream_error')
    })

    it('emits stream_error when executionService is unavailable during lost-stream recovery', async () => {
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue([]),
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: ['msg_1'] }),
      })
      expect((deps as any).executionService).toBeUndefined()

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '69')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: stream_error')
      expect(capturedData).toContain('"errorType":"STREAM_RECOVERY_LOST"')
    })

    it('emits stream_error when metadata is unavailable and replay buffer is empty', async () => {
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue([]),
        getMetadata: vi.fn().mockReturnValue(null),
      })
      ;(deps as any).executionService = {
        subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(false),
      }

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '69')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: recovery_status')
      expect(capturedData).toContain('"streamCompleted":false')
      expect(capturedData).toContain('event: stream_error')
      expect(capturedData).toContain('"errorType":"STREAM_RECOVERY_LOST"')
    })

    it('falls back to complete event detection if recovery metadata is unavailable', async () => {
      const mockEvents = [
        { id: 'e1', type: 'text_delta', sequence: 42, conversationId: 'conv_1', content: 'done', data: {} },
        { id: 'e2', type: 'complete', sequence: 43, conversationId: 'conv_1', content: '', data: { finishReason: 'complete' } },
      ]
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn().mockReturnValue(mockEvents),
        getMetadata: vi.fn().mockReturnValue(null),
      })

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '41')
        .buffer(false)
        .parse((res: any, callback: any) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('"streamCompleted":true')
    })

    it('registers connection in registry by conversationId', async () => {
      const promise = request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .buffer(false)
        .parse((res, callback) => {
          setTimeout(() => {
            expect(deps.registry.hasConnections('conv_1')).toBe(true)
            res.destroy()
            callback(null, '')
          }, 50)
        })

      await promise
    })

    it('returns 404 when conversation does not exist', async () => {
      deps.lifecycle.getById.mockResolvedValueOnce(null)

      const res = await request(app)
        .get('/api/conversations/abcdefghij/nonexistent/stream')
        .set('Accept', 'text/event-stream')

      expect(res.status).toBe(404)
    })

    it('does not replay events for negative Last-Event-ID', async () => {
      const mockGetEventsSince = vi.fn().mockReturnValue([])
      deps.getEventChannel.mockReturnValue({ getEventsSince: mockGetEventsSince })

      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '-1')
        .buffer(false)
        .parse((res, callback) => {
          setTimeout(() => { res.destroy(); callback(null, '') }, 100)
        })

      expect(mockGetEventsSince).not.toHaveBeenCalled()
    })

    it('replays events from Last-Event-ID zero', async () => {
      const mockGetEventsSince = vi.fn().mockReturnValue([])
      deps.getEventChannel.mockReturnValue({
        getEventsSince: mockGetEventsSince,
        getMetadata: vi.fn().mockReturnValue({ pendingMessageIds: [] }),
      })

      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '0')
        .buffer(false)
        .parse((res, callback) => {
          setTimeout(() => { res.destroy(); callback(null, '') }, 100)
        })

      expect(mockGetEventsSince).toHaveBeenCalledWith('conv_1', 0)
    })

    it('writes recovery_status error event when getEventsSince throws', async () => {
      // The only signal the client gets that replay failed is this
      // recovery_status frame. Without this test a regression that swallowed
      // the throw silently would leave the client assuming no buffered events.
      deps.getEventChannel.mockReturnValue({
        getEventsSince: vi.fn(() => { throw new Error('buffer corrupted') }),
      })

      let capturedData = ''
      await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '5')
        .buffer(false)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => { capturedData += chunk.toString() })
          setTimeout(() => { res.destroy(); callback(null, capturedData) }, 100)
        })

      expect(capturedData).toContain('event: recovery_status')
      expect(capturedData).toContain('"bufferedEventCount":0')
      expect(capturedData).toContain('"error":"replay_failed"')
    })

    it('returns 403 when conversation belongs to different app', async () => {
      deps.lifecycle.getById.mockResolvedValueOnce({ id: 'conv_1', appId: 'other_app' })

      const res = await request(app)
        .get('/api/conversations/abcdefghij/conv_1/stream')
        .set('Accept', 'text/event-stream')

      expect(res.status).toBe(403)
    })
  })

  describe('POST /api/conversations/:appId/:conversationId/messages', () => {
    it('returns 202 Accepted with valid payload', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined)
      const depsWithService = {
        ...deps,
        executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) }
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'Hello agent' })

      expect(res.status).toBe(202)
    })

    it('returns 503 when no executionService is provided', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'Hello agent' })

      expect(res.status).toBe(503)
      expect(res.body.error).toBe('Message execution not available')
    })

    it('returns 400 when content is missing', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({})

      expect(res.status).toBe(400)
    })

    it('returns 400 when content is empty string', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: '' })

      expect(res.status).toBe(400)
    })

    it('returns 400 when content exceeds max length', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'x'.repeat(100_001) })

      expect(res.status).toBe(400)
    })

    it('forwards isInitialPrompt=true when conversation has only the just-persisted user message', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined)
      deps.messages.getMessageCount.mockResolvedValue(1)
      const depsWithService = {
        ...deps,
        executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) },
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'first message' })

      expect(res.status).toBe(202)
      // Poll until execute() is called — it fires after the 202 response returns.
      for (let i = 0; i < 50 && mockExecute.mock.calls.length === 0; i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        lifecycleContext: expect.objectContaining({ isInitialPrompt: true }),
      }))
    })

    it('forwards isInitialPrompt=false for multi-turn conversations (count > 1)', async () => {
      const mockExecute = vi.fn().mockResolvedValue(undefined)
      deps.messages.getMessageCount.mockResolvedValue(2)
      const depsWithService = {
        ...deps,
        executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) },
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'follow-up' })

      expect(res.status).toBe(202)
      for (let i = 0; i < 50 && mockExecute.mock.calls.length === 0; i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        lifecycleContext: expect.objectContaining({ isInitialPrompt: false }),
      }))
    })

    it('continues with isInitialPrompt=false when getMessageCount rejects', async () => {
      // Regression guard: the count lookup is advisory. A DB read failure
      // should be logged but must not abort the turn — the execute() still
      // runs with isInitialPrompt: false.
      const mockExecute = vi.fn().mockResolvedValue(undefined)
      deps.messages.getMessageCount.mockRejectedValue(new Error('DB unavailable'))
      const depsWithService = {
        ...deps,
        executionService: { execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) },
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'hi' })

      expect(res.status).toBe(202)
      for (let i = 0; i < 50 && mockExecute.mock.calls.length === 0; i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        lifecycleContext: expect.objectContaining({ isInitialPrompt: false }),
      }))
    })
  })

  describe('POST /api/conversations/:appId/:conversationId/stop', () => {
    it('returns 202 Accepted', async () => {
      const mockStop = vi.fn()
      const depsWithService = {
        ...deps,
        executionService: { execute: vi.fn(), hasActiveStream: vi.fn().mockReturnValue(false), stop: mockStop },
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .post('/api/conversations/abcdefghij/conv_1/stop')

      expect(res.status).toBe(202)
      expect(mockStop).toHaveBeenCalledWith('conv_1')
    })
  })

  describe('POST /api/conversations/:appId/:conversationId/actions', () => {
    it('returns 400 when requestId is missing', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/actions')
        .send({ success: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('requestId is required')
    })

    it('returns 404 when no SSEClientActionService is registered', async () => {
      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/actions')
        .send({ requestId: 'req_1', success: true })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('No pending action service for this conversation')
    })

    it("returns 404 when a registered service lacks resolveAction (WS service shape)", async () => {
      // Register a service that only implements IClientActionService (no resolveAction).
      mockClientActionServices.set('sse:conv_1', {
        executeAction: vi.fn(),
        cleanup: vi.fn(),
      })

      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/actions')
        .send({ requestId: 'req_1', success: true })

      expect(res.status).toBe(404)
    })

    it('returns 404 when requestId does not match a pending request', async () => {
      const resolveAction = vi.fn().mockReturnValue(false)
      mockClientActionServices.set('sse:conv_1', {
        executeAction: vi.fn(),
        cleanup: vi.fn(),
        resolveAction,
      })

      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/actions')
        .send({ requestId: 'req_1', success: true })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('No pending request with this ID')
      expect(resolveAction).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req_1', success: true }))
    })

    it('returns 200 when the action resolves successfully', async () => {
      const resolveAction = vi.fn().mockReturnValue(true)
      mockClientActionServices.set('sse:conv_1', {
        executeAction: vi.fn(),
        cleanup: vi.fn(),
        resolveAction,
      })

      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/actions')
        .send({ requestId: 'req_1', success: true, result: { ok: true } })

      expect(res.status).toBe(200)
      expect(res.body.accepted).toBe(true)
      expect(resolveAction).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_1', success: true, result: { ok: true } })
      )
    })
  })

  describe('POST /api/conversations/:appId/:conversationId/messages — budget paths', () => {
    it('returns 402 when performBudgetPreCheck throws BudgetExceededError', async () => {
      const { BudgetExceededError } = await import('@airo/ai-common')
      const mockExec = {
        execute: vi.fn(),
        stop: vi.fn(),
        subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(false),
      }
      ;(deps as any).executionService = mockExec
      app = express()
      app.use(express.json())
      app.use('/api/conversations', createSSERoutes(deps as any))

      mockBudgetPreCheck.mockRejectedValueOnce(new BudgetExceededError('quota exceeded'))

      const res = await request(app)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'hi' })

      expect(res.status).toBe(402)
      expect(res.body.error).toContain('quota exceeded')
      expect(mockExec.execute).not.toHaveBeenCalled()
    })

    it('forwards non-budget errors through asyncHandler to the Express error handler (500)', async () => {
      const errorApp = express()
      errorApp.use(express.json())
      const errorDeps = createMockDeps()
      ;(errorDeps as any).executionService = {
        execute: vi.fn(), stop: vi.fn(), subscribeStream: vi.fn(),
        hasActiveStream: vi.fn().mockReturnValue(false),
      }
      errorApp.use('/api/conversations', createSSERoutes(errorDeps as any))
      errorApp.use((err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: err?.message ?? 'Internal error' })
      })

      mockBudgetPreCheck.mockRejectedValueOnce(new Error('budget service unreachable'))

      const res = await request(errorApp)
        .post('/api/conversations/abcdefghij/conv_1/messages')
        .send({ content: 'hi' })

      expect(res.status).toBe(500)
      expect(res.body.error).toBe('budget service unreachable')
    })
  })

  describe('PUT /api/conversations/:appId/:conversationId/grants', () => {
    it('returns 400 when grants is not an array', async () => {
      const res = await request(app)
        .put('/api/conversations/abcdefghij/conv_1/grants')
        .send({ grants: 'not-an-array' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('grants array is required')
    })

    it('sets grants and returns 200', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')

      const res = await request(app)
        .put('/api/conversations/abcdefghij/conv_1/grants')
        .send({ grants: ['read', 'write'] })

      expect(res.status).toBe(200)
      expect(grantSessionManager.setGrants).toHaveBeenCalledWith('sse:conv_1', ['read', 'write'])
    })
  })

  describe('GET /api/conversations/:appId/:conversationId/messages', () => {
    it('returns paginated messages', async () => {
      deps.messages.getMessagesPaginated.mockResolvedValueOnce({
        messages: [
          { id: 'm1', conversationId: 'conv_1', sender: 'user', content: 'hi', createdAt: new Date() },
        ],
        hasMore: false,
        nextCursor: null,
        total: 1,
      })

      const res = await request(app)
        .get('/api/conversations/abcdefghij/conv_1/messages')

      expect(res.status).toBe(200)
      expect(res.body.messages).toHaveLength(1)
      expect(res.body.total).toBe(1)
    })

    it('clears stale inProgress when no active stream exists', async () => {
      deps.messages.getMessagesPaginated.mockResolvedValueOnce({
        messages: [
          {
            id: 'm1', conversationId: 'conv_1', sender: 'agent', content: 'partial',
            createdAt: new Date(), metadata: { inProgress: true, other: 'x' },
          },
        ],
        hasMore: false,
        nextCursor: null,
        total: 1,
      })
      const depsWithService = {
        ...deps,
        executionService: { execute: vi.fn(), hasActiveStream: vi.fn().mockReturnValue(false) },
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .get('/api/conversations/abcdefghij/conv_1/messages')

      expect(res.status).toBe(200)
      expect(res.body.messages[0].metadata).toEqual({ inProgress: false, other: 'x' })
    })

    it('preserves inProgress when a stream is active', async () => {
      deps.messages.getMessagesPaginated.mockResolvedValueOnce({
        messages: [
          {
            id: 'm1', conversationId: 'conv_1', sender: 'agent', content: 'partial',
            createdAt: new Date(), metadata: { inProgress: true },
          },
        ],
        hasMore: false,
        nextCursor: null,
        total: 1,
      })
      const depsWithService = {
        ...deps,
        executionService: { execute: vi.fn(), hasActiveStream: vi.fn().mockReturnValue(true) },
      }
      const appWithService = express()
      appWithService.use(express.json())
      appWithService.use('/api/conversations', createSSERoutes(depsWithService as any))

      const res = await request(appWithService)
        .get('/api/conversations/abcdefghij/conv_1/messages')

      expect(res.body.messages[0].metadata.inProgress).toBe(true)
    })

    it('preserves inProgress on paginated requests (before cursor)', async () => {
      deps.messages.getMessagesPaginated.mockResolvedValueOnce({
        messages: [
          {
            id: 'm1', conversationId: 'conv_1', sender: 'agent', content: 'partial',
            createdAt: new Date(), metadata: { inProgress: true },
          },
        ],
        hasMore: false,
        nextCursor: null,
        total: 1,
      })

      const res = await request(app)
        .get('/api/conversations/abcdefghij/conv_1/messages?before=m2')

      expect(res.body.messages[0].metadata.inProgress).toBe(true)
    })
  })

  // Regression: Express 4 does not auto-forward rejections from async
  // handlers to the error middleware. The asyncHandler wrapper is what turns
  // a rejected middleware/handler into a 500 — without it the client hangs
  // forever waiting for a response. This test drives the pathway that
  // actually failed in review: validateConversationOwnership's getById DB
  // call rejecting.
  describe('Express 4 async rejection forwarding', () => {
    it('forwards validateConversationOwnership DB errors to the error handler', async () => {
      const errorApp = express()
      errorApp.use(express.json())
      const errorDeps = createMockDeps()
      errorDeps.lifecycle.getById.mockRejectedValueOnce(new Error('DB connection lost'))
      errorApp.use('/api/conversations', createSSERoutes(errorDeps as any))
      errorApp.use((err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: err?.message ?? 'Internal error' })
      })

      const res = await request(errorApp)
        .get('/api/conversations/abcdefghij/conv_1/messages')

      expect(res.status).toBe(500)
      expect(res.body.error).toBe('DB connection lost')
    })
  })
})
