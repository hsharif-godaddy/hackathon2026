import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  StreamTimingTracker,
  SLOW_CHUNK_GAP_THRESHOLD_MS,
} from '../stream-timing-tracker.js'

function makeDeps(overrides: Partial<{
  socketId: string
  aborted: boolean
}> = {}) {
  const socketId = overrides.socketId ?? 'sock-1'
  const aborted = overrides.aborted ?? false
  return {
    socket: {
      id: socketId,
      emit: vi.fn(),
    },
    agentName: 'test-agent',
    modelName: 'claude-sonnet-4-6',
    logger: { warn: vi.fn() },
    abortController: { signal: { aborted } },
  }
}

function makeAbortError(): Error {
  const err = new Error('AbortError')
  err.name = 'AbortError'
  return err
}

describe('StreamTimingTracker', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null
  let originalEvals: string | undefined

  beforeEach(() => {
    originalEvals = process.env.SOCKET_DIAGNOSTICS
    delete process.env.SOCKET_DIAGNOSTICS
    dateNowSpy = null
  })

  afterEach(() => {
    if (originalEvals !== undefined) {
      process.env.SOCKET_DIAGNOSTICS = originalEvals
    } else {
      delete process.env.SOCKET_DIAGNOSTICS
    }
    dateNowSpy?.mockRestore()
  })

  describe('recordChunk()', () => {
    it('tracks maxChunkGapMs across multiple chunks', () => {
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 1100; tracker.recordChunk() // first chunk, gap = 100ms
      now = 1600; tracker.recordChunk() // gap = 500ms
      now = 1900; tracker.recordChunk() // gap = 300ms

      const data = tracker.finalize()
      expect(data.maxChunkGapMs).toBe(500)
    })

    it(
      'emits stream.chunk.slow_gap when gap ' +
      'exceeds threshold and ' +
      'SOCKET_DIAGNOSTICS=true',
      () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)
        const overThreshold =
          SLOW_CHUNK_GAP_THRESHOLD_MS + 1_000

        now = 1100; tracker.recordChunk()
        now = 1100 + overThreshold
        tracker.recordChunk()

        expect(deps.socket.emit).toHaveBeenCalledWith(
          'stream.chunk.slow_gap',
          expect.objectContaining({
            socketId: 'sock-1',
            agentName: 'test-agent',
            modelName: 'claude-sonnet-4-6',
            gapMs: overThreshold,
          })
        )
      }
    )

    it(
      'does NOT emit slow_gap when ' +
      'SOCKET_DIAGNOSTICS is unset',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)
        const overThreshold =
          SLOW_CHUNK_GAP_THRESHOLD_MS + 1_000

        now = 1100; tracker.recordChunk()
        now = 1100 + overThreshold
        tracker.recordChunk()

        expect(deps.socket.emit)
          .not.toHaveBeenCalled()
      }
    )

    it(
      'logs slow_gap via logger.warn regardless ' +
      'of env var',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)
        const overThreshold =
          SLOW_CHUNK_GAP_THRESHOLD_MS + 1_000

        now = 1100; tracker.recordChunk()
        now = 1100 + overThreshold
        tracker.recordChunk()

        expect(deps.logger.warn).toHaveBeenCalledWith(
          'stream.chunk.slow_gap',
          expect.objectContaining({
            gapMs: overThreshold,
          })
        )
      }
    )
  })

  describe('recordTimeout()', () => {
    it(
      'emits stream.chunk.timeout when SOCKET_DIAGNOSTICS=true',
      () => {
        process.env.SOCKET_DIAGNOSTICS = 'true'
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)
        const err = makeAbortError()

        tracker.recordTimeout(err.message)

        expect(deps.socket.emit).toHaveBeenCalledWith(
          'stream.chunk.timeout',
          expect.objectContaining({
            socketId: 'sock-1',
            agentName: 'test-agent',
            error: err.message,
          })
        )
      }
    )

    it(
      'does NOT emit socket event when SOCKET_DIAGNOSTICS is unset',
      () => {
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)
        const err = makeAbortError()

        tracker.recordTimeout(err.message)

        expect(deps.socket.emit).not.toHaveBeenCalled()
      }
    )

    it('always logs via logger.warn', () => {
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)
      const err = makeAbortError()

      tracker.recordTimeout(err.message)

      expect(deps.logger.warn).toHaveBeenCalledWith(
        'stream.chunk.timeout',
        expect.objectContaining({
          error: err.message,
        })
      )
    })
  })

  describe('recordTextChunk()', () => {
    it('first call sets timeToFirstTextChunkMs', () => {
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 1500
      tracker.recordTextChunk()

      expect(tracker.finalize().timeToFirstTextChunkMs).toBe(500)
    })

    it('only records the first call', () => {
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 1500
      tracker.recordTextChunk()
      now = 2000
      tracker.recordTextChunk()

      expect(tracker.finalize().timeToFirstTextChunkMs).toBe(500)
    })

    it('defaults to null when never called', () => {
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 1200
      tracker.recordChunk()

      expect(tracker.finalize().timeToFirstTextChunkMs).toBeNull()
    })

    it('records timeToFirstTextChunkMs when text follows non-text chunks', () => {
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 1200; tracker.recordChunk()
      now = 1400; tracker.recordChunk()
      now = 1800
      tracker.recordChunk()
      tracker.recordTextChunk()

      expect(tracker.finalize().timeToFirstTextChunkMs).toBe(800)
    })

    it(
      'recordTimeout includes timeToFirstTextChunkMs in payload',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        now = 1500
        tracker.recordTextChunk()

        const err = makeAbortError()
        tracker.recordTimeout(err.message)

        expect(deps.logger.warn).toHaveBeenCalledWith(
          'stream.chunk.timeout',
          expect.objectContaining({
            timeToFirstTextChunkMs: 500,
          })
        )
      }
    )
  })

  describe('finalize()', () => {
    it('returns correct StreamTimingData after chunks', () => {
      let now = 1000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 1200; tracker.recordChunk()
      now = 1700; tracker.recordChunk()

      const data = tracker.finalize()
      expect(data).toEqual({
        timeToFirstTextChunkMs: null,
        maxChunkGapMs: 500,
        chunksRead: 2,
        streamDurationMs: 700,
      })
    })

    it('streamDurationMs reflects elapsed time', () => {
      let now = 5000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
      const deps = makeDeps()
      const tracker = new StreamTimingTracker(deps)

      now = 8000
      const data = tracker.finalize()
      expect(data.streamDurationMs).toBe(3000)
    })
  })

  describe('getters', () => {
    it(
      'chunksRead and streamElapsedMs return current values',
      () => {
        let now = 2000
        dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        expect(tracker.chunksRead).toBe(0)

        now = 2100; tracker.recordChunk()
        now = 2400; tracker.recordChunk()

        expect(tracker.chunksRead).toBe(2)
        expect(tracker.streamElapsedMs).toBe(400)
      }
    )
  })

  it('SLOW_CHUNK_GAP_THRESHOLD_MS is 90_000', () => {
    expect(SLOW_CHUNK_GAP_THRESHOLD_MS).toBe(90_000)
  })

  describe('pauseGapTracking() / resumeGapTracking()', () => {
    it(
      'pause prevents slow_gap warning for tool execution time',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        now = 1100; tracker.recordChunk() // first chunk
        tracker.pauseGapTracking()
        now = 1100 + 100_000 // 100s tool execution
        tracker.resumeGapTracking()
        now += 200; tracker.recordChunk() // chunk 200ms after resume

        expect(deps.logger.warn).not.toHaveBeenCalledWith(
          'stream.chunk.slow_gap',
          expect.anything()
        )
      }
    )

    it(
      'resume + next chunk measures gap from resume point',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        now = 1100; tracker.recordChunk()
        tracker.pauseGapTracking()
        now = 62_000 // 60s tool
        tracker.resumeGapTracking()
        now = 62_200; tracker.recordChunk()

        const data = tracker.finalize()
        expect(data.maxChunkGapMs).toBe(200)
      }
    )

    it(
      'pause/resume does not affect chunksRead count',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        now = 1100; tracker.recordChunk()
        now = 1200; tracker.recordChunk()
        tracker.pauseGapTracking()
        tracker.resumeGapTracking()
        now = 1400; tracker.recordChunk()
        now = 1500; tracker.recordChunk()

        expect(tracker.chunksRead).toBe(4)
      }
    )

    it(
      'logs stream.tool.slow_execution when ' +
      'tool >= threshold',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        now = 1100; tracker.recordChunk()
        tracker.pauseGapTracking('terminalCommand')
        // exactly at threshold
        now = 1100 + SLOW_CHUNK_GAP_THRESHOLD_MS
        tracker.resumeGapTracking()

        expect(deps.logger.warn).toHaveBeenCalledWith(
          'stream.tool.slow_execution',
          expect.objectContaining({
            socketId: 'sock-1',
            agentName: 'test-agent',
            modelName: 'claude-sonnet-4-6',
            toolName: 'terminalCommand',
            toolDurationMs:
              SLOW_CHUNK_GAP_THRESHOLD_MS,
          })
        )
      }
    )

    it(
      'does not log slow_execution when ' +
      'tool < threshold',
      () => {
        let now = 1000
        dateNowSpy = vi.spyOn(Date, 'now')
          .mockImplementation(function () { return now; })
        const deps = makeDeps()
        const tracker = new StreamTimingTracker(deps)

        now = 1100; tracker.recordChunk()
        tracker.pauseGapTracking('readFile')
        // just under threshold
        now = 1100 + SLOW_CHUNK_GAP_THRESHOLD_MS - 1
        tracker.resumeGapTracking()

        expect(deps.logger.warn)
          .not.toHaveBeenCalledWith(
            'stream.tool.slow_execution',
            expect.anything()
          )
      }
    )
  })
})
