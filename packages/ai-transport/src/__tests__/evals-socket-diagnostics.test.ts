import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Server as HTTPServer } from 'http'
import type { LanguageModelUsage } from 'ai'
import { WebSocketServer } from '../experimental-websocket-server.js'
import { createNoOpPersistence } from '../noop-persistence.js'
import type { AgentWrapper } from '@airo/ai-lib'
import { TOKEN_USAGE_SUMMARY_EVENT } from '@airo/ai-lib'

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? DeepPartial<T[P]>
    : T[P]
}

// --- Module-level mocks (same pattern as existing test file) ---

const mockSocket: Record<string, any> = {
  id: 'test-socket-id',
  emit: vi.fn(),
  on: vi.fn(),
  connected: true,
  data: {},
  handshake: { auth: {} },
  volatile: { emit: vi.fn() },
}

const mockIO = {
  on: vi.fn(),
  close: vi.fn(),
}

vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(() => mockIO),
}))

const { mockCreateTraceContext } = vi.hoisted(() => ({
  mockCreateTraceContext: vi.fn().mockReturnValue(
    Symbol('trace-context')
  ),
}))
vi.mock('@signals/otel-sdk', () => ({
  createTraceContext: mockCreateTraceContext,
}))

const mockAgent: AgentWrapper = {
  getName: () => 'test-agent',
  streamGenerate: vi.fn(),
} as any

const mockAgents = {
  get: vi.fn().mockReturnValue(mockAgent),
  list: vi.fn().mockReturnValue(['test-agent']),
}

// --- Helpers ---

async function setupServerWithConnection(
  httpServer: HTTPServer,
  config: {
    agents: typeof mockAgents
    defaultAgent: string
    messagePersistence?: any
  }
): Promise<{
  server: WebSocketServer
  messageHandler: (data: any) => Promise<void>
}> {
  let connectionHandler:
    | ((socket: any) => Promise<void>)
    | null = null

  mockIO.on.mockImplementation(
    (event: string, handler: any) => {
      if (event === 'connection') {
        connectionHandler = handler
      }
    }
  )

  const configWithPersistence = {
    ...config,
    messagePersistence:
      config.messagePersistence ?? createNoOpPersistence(),
  }

  const server = new WebSocketServer(
    httpServer,
    configWithPersistence
  )

  if (connectionHandler) {
    await connectionHandler(mockSocket)
  }

  const onCall = mockSocket.on.mock.calls.find(
    (call: any[]) => call[0] === 'chat'
  )
  if (!onCall) {
    throw new Error(
      'chat handler not found after connection setup'
    )
  }

  return { server, messageHandler: onCall[1] }
}

function createMockReader(
  ...reads: Array<
    | { value: any }
    | { error: Error }
    | 'done'
  >
) {
  const readMock = vi.fn()
  for (const r of reads) {
    if (r === 'done') {
      readMock.mockResolvedValueOnce({ done: true })
    } else if ('error' in r) {
      readMock.mockRejectedValueOnce(r.error)
    } else {
      readMock.mockResolvedValueOnce({
        done: false,
        value: r.value,
      })
    }
  }
  return {
    read: readMock,
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn(),
  }
}

function textDelta(text: string) {
  return {
    value: {
      part: { type: 'text-delta', textDelta: text },
    },
  }
}

function createStreamResult(
  reader: ReturnType<typeof createMockReader>,
  textChunks: string[] = ['hello'],
  usageOverride?: DeepPartial<LanguageModelUsage>
) {
  const usage = usageOverride ?? {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  }
  return {
    baseStream: {
      getReader: vi.fn().mockReturnValue(reader),
    },
    textStream: (async function* () {
      for (const chunk of textChunks) yield chunk
    })(),
    getFinalResult: vi.fn().mockResolvedValue({
      usage,
      toolCalls: [],
      finishReason: 'stop',
    }),
  }
}

// --- Tests ---

describe('Evals Socket Diagnostics', () => {
  let server: WebSocketServer
  let httpServer: HTTPServer
  let savedEvalsOverSocket: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer()
    savedEvalsOverSocket =
      process.env.SOCKET_DIAGNOSTICS
  })

  afterEach(() => {
    delete (mockAgent as any).getConfig
    if (savedEvalsOverSocket === undefined) {
      delete process.env.SOCKET_DIAGNOSTICS
    } else {
      process.env.SOCKET_DIAGNOSTICS =
        savedEvalsOverSocket
    }
    server?.close()
  })

  function setupSuccessfulStream(
    usageOverride?: DeepPartial<LanguageModelUsage>
  ) {
    const reader = createMockReader(
      textDelta('hello'),
      'done'
    )
    const streamResult = createStreamResult(
      reader, ['hello'], usageOverride
    )
    mockAgent.streamGenerate =
      vi.fn().mockResolvedValueOnce(streamResult)
  }

  describe('stream.timing.summary', () => {

    it(
      'emits via socket when SOCKET_DIAGNOSTICS=true',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        setupSuccessfulStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const emitCalls = mockSocket.emit.mock.calls
        const summaryEmit = emitCalls.find(
          (c: any[]) =>
            c[0] === 'stream.timing.summary'
        )
        expect(summaryEmit).toBeDefined()
        expect(summaryEmit![1]).toEqual(
          expect.objectContaining({
            socketId: 'test-socket-id',
            agentName: 'test-agent',
            timeToFirstTextChunkMs: expect.any(Number),
            maxChunkGapMs: expect.any(Number),
            chunksRead: expect.any(Number),
            streamDurationMs: expect.any(Number),
          })
        )
      }
    )

    it(
      'does NOT emit when env var is unset',
      async () => {
        delete process.env.SOCKET_DIAGNOSTICS
        setupSuccessfulStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const summaryEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === 'stream.timing.summary'
          )
        expect(summaryEmit).toBeUndefined()
      }
    )

    it(
      'swallows emit errors without propagating',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        setupSuccessfulStream()

        mockSocket.emit.mockImplementation(
          (event: string) => {
            if (event === 'stream.timing.summary') {
              throw new Error('socket closed')
            }
          }
        )

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await expect(
          messageHandler({
            message: 'test',
            agentId: 'test-agent',
          })
        ).resolves.not.toThrow()
      }
    )
  })

  describe('token.usage.summary', () => {
    it(
      'emits via socket when SOCKET_DIAGNOSTICS=true',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        setupSuccessfulStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const emitCalls = mockSocket.emit.mock.calls
        const usageEmit = emitCalls.find(
          (c: any[]) =>
            c[0] === TOKEN_USAGE_SUMMARY_EVENT
        )
        expect(usageEmit).toBeDefined()
        expect(usageEmit![1]).toEqual(
          expect.objectContaining({
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            modelName: expect.any(String),
            totalCost: expect.any(Number),
            inputCost: expect.any(Number),
            outputCost: expect.any(Number),
            savings: expect.any(Number),
            currency: expect.any(String),
          })
        )
        expect(usageEmit![1]).not.toHaveProperty(
          'cachedInputTokensRead'
        )
        expect(usageEmit![1]).not.toHaveProperty(
          'cachedInputTokensWrite'
        )
        expect(usageEmit![1]).not.toHaveProperty(
          'cachedInputCost'
        )
      }
    )

    it(
      'includes cache fields when present',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        ;(mockAgent as any).getConfig =
          () => ({ modelName: 'claude-sonnet-4-6' })
        setupSuccessfulStream({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputTokenDetails: {
            cacheReadTokens: 40,
          },
        })

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeDefined()
        expect(usageEmit![1]).toEqual(
          expect.objectContaining({
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cachedInputTokensRead: 40,
            cachedInputCost: expect.any(Number),
            modelName: 'claude-sonnet-4-6',
          })
        )
        expect(usageEmit![1].cachedInputCost)
          .toBeGreaterThan(0)
        expect(usageEmit![1]).not.toHaveProperty(
          'cachedInputTokensWrite'
        )
      }
    )

    it(
      'includes cachedInputTokensWrite when present',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        ;(mockAgent as any).getConfig =
          () => ({ modelName: 'claude-sonnet-4-6' })
        setupSuccessfulStream({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputTokenDetails: {
            cacheWriteTokens: 20,
          },
        })

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeDefined()
        expect(usageEmit![1]).toEqual(
          expect.objectContaining({
            cachedInputTokensWrite: 20,
            cachedInputCost: expect.any(Number),
          })
        )
        expect(usageEmit![1].cachedInputCost)
          .toBeGreaterThan(0)
        expect(usageEmit![1]).not.toHaveProperty(
          'cachedInputTokensRead'
        )
      }
    )

    it(
      'includes both cache read and write fields',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        ;(mockAgent as any).getConfig =
          () => ({ modelName: 'claude-sonnet-4-6' })
        setupSuccessfulStream({
          inputTokens: 200,
          outputTokens: 80,
          totalTokens: 280,
          inputTokenDetails: {
            cacheReadTokens: 60,
            cacheWriteTokens: 30,
          },
        })

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeDefined()
        expect(usageEmit![1]).toEqual(
          expect.objectContaining({
            inputTokens: 200,
            outputTokens: 80,
            totalTokens: 280,
            cachedInputTokensRead: 60,
            cachedInputTokensWrite: 30,
            cachedInputCost: expect.any(Number),
            modelName: 'claude-sonnet-4-6',
          })
        )
        expect(usageEmit![1].cachedInputCost)
          .toBeGreaterThan(0)
      }
    )

    it(
      'does NOT emit when env var is unset',
      async () => {
        delete process.env.SOCKET_DIAGNOSTICS
        setupSuccessfulStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeUndefined()
      }
    )

    it(
      'swallows emit errors without propagating',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        setupSuccessfulStream()

        mockSocket.emit.mockImplementation(
          (event: string) => {
            if (event === TOKEN_USAGE_SUMMARY_EVENT) {
              throw new Error('socket closed')
            }
          }
        )

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await expect(
          messageHandler({
            message: 'test',
            agentId: 'test-agent',
          })
        ).resolves.not.toThrow()
      }
    )

    it(
      'does NOT emit when usage is undefined',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'

        const reader = createMockReader(
          textDelta('hello'),
          'done'
        )
        const streamResult = createStreamResult(reader, ['hello'])
        streamResult.getFinalResult = vi.fn().mockResolvedValue({
          usage: undefined,
          totalUsage: undefined,
          toolCalls: [],
          finishReason: 'stop',
        })
        mockAgent.streamGenerate =
          vi.fn().mockResolvedValueOnce(streamResult)

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeUndefined()
      }
    )

    it(
      'prefers totalUsage over usage for multi-step tracking',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        ;(mockAgent as any).getConfig =
          () => ({ modelName: 'claude-sonnet-4-6' })

        const reader = createMockReader(
          textDelta('hello'),
          'done'
        )
        const streamResult = createStreamResult(reader, ['hello'])
        streamResult.getFinalResult = vi.fn().mockResolvedValue({
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
          totalUsage: {
            inputTokens: 300,
            outputTokens: 120,
            totalTokens: 420,
          },
          toolCalls: [],
          finishReason: 'stop',
        })
        mockAgent.streamGenerate =
          vi.fn().mockResolvedValueOnce(streamResult)

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeDefined()
        expect(usageEmit![1]).toEqual(
          expect.objectContaining({
            inputTokens: 300,
            outputTokens: 120,
            totalTokens: 420,
            modelName: 'claude-sonnet-4-6',
          })
        )
      }
    )

    it(
      'emits with agent name fallback when getConfig() throws',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        ;(mockAgent as any).getConfig = () => {
          throw new Error('config unavailable')
        }
        setupSuccessfulStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const usageEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === TOKEN_USAGE_SUMMARY_EVENT
          )
        expect(usageEmit).toBeDefined()
        expect(usageEmit![1]).toEqual(
          expect.objectContaining({
            modelName: 'test-agent',
          })
        )
      }
    )
  })

  describe('stream.chunk.slow_gap', () => {
    let dateNowSpy:
      | ReturnType<typeof vi.spyOn>
      | null = null

    afterEach(() => {
      dateNowSpy?.mockRestore()
      dateNowSpy = null
    })

    function setupSlowGapStream() {
      // Mutable clock controlled by reader mocks.
      // Starts at T=1000; first chunk sets T=1100;
      // second chunk jumps to T=92100 (91s gap).
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now')
        .mockImplementation(() => now)

      const reader = createMockReader(
        textDelta('a'),
        textDelta('b'),
        'done'
      )
      // Advance clock when each chunk is read
      const originalRead = reader.read
      let readCount = 0
      reader.read = vi.fn().mockImplementation(
        () => {
          readCount++
          if (readCount === 1) now = 1100
          if (readCount === 2) now = 92100
          return originalRead()
        }
      )

      const streamResult = createStreamResult(
        reader, ['a', 'b']
      )
      mockAgent.streamGenerate =
        vi.fn().mockResolvedValueOnce(streamResult)
    }

    it(
      'emits via socket when SOCKET_DIAGNOSTICS=true',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        setupSlowGapStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const emitCalls = mockSocket.emit.mock.calls
        const slowGapEmit = emitCalls.find(
          (c: any[]) =>
            c[0] === 'stream.chunk.slow_gap'
        )
        expect(slowGapEmit).toBeDefined()
        expect(slowGapEmit![1]).toEqual(
          expect.objectContaining({
            socketId: 'test-socket-id',
            agentName: 'test-agent',
            gapMs: expect.any(Number),
            chunksRead: expect.any(Number),
            streamElapsedMs: expect.any(Number),
          })
        )
      }
    )

    it(
      'does NOT emit when env var is unset',
      async () => {
        delete process.env.SOCKET_DIAGNOSTICS
        setupSlowGapStream()

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const slowGapEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === 'stream.chunk.slow_gap'
          )
        expect(slowGapEmit).toBeUndefined()
      }
    )
  })

  describe('stream.chunk.timeout', () => {
    function setupTimeoutStream(
      srv: WebSocketServer
    ) {
      const abortError = new Error(
        'The operation was aborted'
      )
      abortError.name = 'AbortError'

      const readMock = vi.fn()
      readMock.mockResolvedValueOnce({
        done: false,
        value: {
          part: {
            type: 'text-delta',
            textDelta: 'a',
          },
        },
      })
      readMock.mockImplementationOnce(() => {
        const ac = (srv as any).stateManager
          .getAbortController('test-socket-id')
        if (ac) ac.abort('chunk_timeout')
        return Promise.reject(abortError)
      })

      const reader = {
        read: readMock,
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn(),
      }
      const streamResult = createStreamResult(
        reader, ['fallback']
      )
      mockAgent.streamGenerate =
        vi.fn().mockResolvedValueOnce(streamResult)
    }

    it(
      'emits via socket when SOCKET_DIAGNOSTICS=true',
      async () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s
        setupTimeoutStream(server)

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const emitCalls = mockSocket.emit.mock.calls
        const timeoutEmit = emitCalls.find(
          (c: any[]) =>
            c[0] === 'stream.chunk.timeout'
        )
        expect(timeoutEmit).toBeDefined()
        expect(timeoutEmit![1]).toEqual(
          expect.objectContaining({
            socketId: 'test-socket-id',
            agentName: 'test-agent',
            error: expect.any(String),
            chunksRead: expect.any(Number),
          })
        )
      }
    )

    it(
      'does NOT emit when env var is unset',
      async () => {
        delete process.env.SOCKET_DIAGNOSTICS

        const { server: s, messageHandler } =
          await setupServerWithConnection(httpServer, {
            agents: mockAgents,
            defaultAgent: 'test-agent',
          })
        server = s
        setupTimeoutStream(server)

        await messageHandler({
          message: 'test',
          agentId: 'test-agent',
        })

        const timeoutEmit =
          mockSocket.emit.mock.calls.find(
            (c: any[]) =>
              c[0] === 'stream.chunk.timeout'
          )
        expect(timeoutEmit).toBeUndefined()
      }
    )
  })
})
