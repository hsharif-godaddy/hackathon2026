import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  ChunkTimeoutGuard,
  CHUNK_GAP_WARNING_THRESHOLDS_MS,
  DEFAULT_CHUNK_TIMEOUT_MS,
} from '../chunk-timeout-guard.js'

function makeDeps(overrides: Partial<{ aborted: boolean }> = {}) {
  const abortFn = vi.fn()
  const abortController = {
    signal: {
      aborted: overrides.aborted ?? false,
      addEventListener: vi.fn(),
    },
    abort: abortFn,
  } as unknown as AbortController
  return {
    abortController,
    logger: { warn: vi.fn() },
    socketId: 'sock-1',
    agentName: 'test-agent',
    modelName: 'claude-sonnet-4-6',
  }
}

describe('ChunkTimeoutGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('DEFAULT_CHUNK_TIMEOUT_MS is 180_000', () => {
    expect(DEFAULT_CHUNK_TIMEOUT_MS).toBe(180_000)
  })

  describe('arm()', () => {
    it('aborts controller after default timeout elapses', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps)

      guard.arm()
      vi.advanceTimersByTime(180_000)

      expect(deps.abortController.abort).toHaveBeenCalledWith(
        'chunk_timeout'
      )
    })

    it('uses custom timeout when provided', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      vi.advanceTimersByTime(4_999)
      expect(deps.abortController.abort).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(deps.abortController.abort).toHaveBeenCalledWith(
        'chunk_timeout'
      )
    })

    it('skips log and abort when signal aborted externally', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      ;(deps.abortController.signal as any).aborted = true
      vi.advanceTimersByTime(5_000)

      expect(deps.abortController.abort).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })

    it('skips arming when controller is already aborted', () => {
      const deps = makeDeps({ aborted: true })
      const guard = new ChunkTimeoutGuard(deps)

      guard.arm()
      vi.advanceTimersByTime(180_000)

      expect(deps.abortController.abort).not.toHaveBeenCalled()
    })

    it(
      'logs stream.chunk.timeout.transport with diagnostics ' +
      'when firing',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(deps, 5_000)

        guard.arm()
        vi.advanceTimersByTime(5_000)

        expect(deps.logger.warn).toHaveBeenCalledWith(
          'stream.chunk.timeout.transport',
          expect.objectContaining({
            socketId: 'sock-1',
            agentName: 'test-agent',
            modelName: 'claude-sonnet-4-6',
            timeoutMs: 5_000,
          })
        )
      }
    )

    it('clears pending timer when signal is aborted externally', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()

      const addEventListenerMock = deps.abortController.signal
        .addEventListener as ReturnType<typeof vi.fn>
      const [, abortHandler] = addEventListenerMock.mock.calls[0]
      abortHandler()

      vi.advanceTimersByTime(5_000)

      expect(deps.abortController.abort).not.toHaveBeenCalled()
    })
  })

  describe('reset()', () => {
    it('restarts the countdown', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      vi.advanceTimersByTime(4_000)
      guard.reset()
      vi.advanceTimersByTime(4_000)
      expect(deps.abortController.abort).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1_001)
      expect(deps.abortController.abort).toHaveBeenCalledWith(
        'chunk_timeout'
      )
    })

    it('re-arms correctly after pause()', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      guard.pause()
      vi.advanceTimersByTime(5_000)
      expect(deps.abortController.abort).not.toHaveBeenCalled()

      guard.reset()
      vi.advanceTimersByTime(5_000)
      expect(deps.abortController.abort).toHaveBeenCalledWith(
        'chunk_timeout'
      )
    })
  })

  describe('pause()', () => {
    it('stops the countdown without aborting', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      guard.pause()
      vi.advanceTimersByTime(5_000)

      expect(deps.abortController.abort).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })

  describe('dispose()', () => {
    it('prevents abort after timer would have expired', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      vi.advanceTimersByTime(4_000)
      guard.dispose()
      vi.advanceTimersByTime(1_001)

      expect(deps.abortController.abort).not.toHaveBeenCalled()
    })
  })

  describe('CHUNK_GAP_WARNING_THRESHOLDS_MS', () => {
    it('contains 120_000 and 150_000', () => {
      expect(CHUNK_GAP_WARNING_THRESHOLDS_MS).toEqual(
        [120_000, 150_000]
      )
    })
  })

  describe('gap warnings', () => {
    it(
      'logs stream.chunk.gap_warning at each threshold ' +
      'before abort',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(deps)

        guard.arm()

        vi.advanceTimersByTime(120_000)
        expect(deps.logger.warn).toHaveBeenCalledWith(
          'stream.chunk.gap_warning',
          expect.objectContaining({
            socketId: 'sock-1',
            agentName: 'test-agent',
            modelName: 'claude-sonnet-4-6',
            elapsedMs: 120_000,
            timeoutMs: 180_000,
          })
        )

        vi.advanceTimersByTime(30_000)
        expect(deps.logger.warn).toHaveBeenCalledWith(
          'stream.chunk.gap_warning',
          expect.objectContaining({
            elapsedMs: 150_000,
            timeoutMs: 180_000,
          })
        )

        expect(deps.abortController.abort)
          .not.toHaveBeenCalled()
      }
    )

    it(
      'does not fire warnings when timeout is shorter ' +
      'than threshold',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(deps, 60_000)

        guard.arm()
        vi.advanceTimersByTime(60_000)

        expect(deps.logger.warn).not.toHaveBeenCalledWith(
          'stream.chunk.gap_warning',
          expect.anything()
        )
        expect(deps.abortController.abort)
          .toHaveBeenCalledWith('chunk_timeout')
      }
    )

    it('reset() clears and reschedules warnings', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps)

      guard.arm()
      vi.advanceTimersByTime(110_000)
      guard.reset()

      vi.advanceTimersByTime(120_000)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'stream.chunk.gap_warning',
        expect.objectContaining({ elapsedMs: 120_000 })
      )
    })

    it('pause() clears pending warnings', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps)

      guard.arm()
      guard.pause()
      vi.advanceTimersByTime(180_000)

      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        'stream.chunk.gap_warning',
        expect.anything()
      )
    })

    it('dispose() clears pending warnings', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(deps)

      guard.arm()
      vi.advanceTimersByTime(100_000)
      guard.dispose()
      vi.advanceTimersByTime(80_000)

      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        'stream.chunk.gap_warning',
        expect.anything()
      )
    })

    it(
      'skips warnings when signal is already aborted',
      () => {
        const deps = makeDeps({ aborted: true })
        const guard = new ChunkTimeoutGuard(deps)

        guard.arm()
        vi.advanceTimersByTime(180_000)

        expect(deps.logger.warn).not.toHaveBeenCalled()
      }
    )

    it(
      'does not log warning if signal aborted before ' +
      'threshold fires',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(deps)

        guard.arm()
        vi.advanceTimersByTime(100_000)
        ;(deps.abortController.signal as any).aborted = true
        vi.advanceTimersByTime(50_000)

        expect(deps.logger.warn).not.toHaveBeenCalledWith(
          'stream.chunk.gap_warning',
          expect.anything()
        )
      }
    )
  })
})
