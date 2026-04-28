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

// Derive test timeout from thresholds so tests never
// break when constants change.
const LAST_THRESHOLD =
  CHUNK_GAP_WARNING_THRESHOLDS_MS[
    CHUNK_GAP_WARNING_THRESHOLDS_MS.length - 1
  ]
const TEST_TIMEOUT_MS = LAST_THRESHOLD + 60_000

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

  it('DEFAULT_CHUNK_TIMEOUT_MS is -1 (disabled)', () => {
    expect(DEFAULT_CHUNK_TIMEOUT_MS).toBe(-1)
  })

  describe('arm()', () => {
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
      const guard = new ChunkTimeoutGuard(deps, 5_000)

      guard.arm()
      vi.advanceTimersByTime(5_000)

      expect(deps.abortController.abort)
        .not.toHaveBeenCalled()
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

  describe('gap warnings', () => {
    it(
      'logs stream.chunk.gap_warning at each ' +
      'threshold before abort',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(
          deps, TEST_TIMEOUT_MS
        )
        const thresholds =
          CHUNK_GAP_WARNING_THRESHOLDS_MS

        guard.arm()

        for (let i = 0; i < thresholds.length; i++) {
          const advance = i === 0
            ? thresholds[0]
            : thresholds[i] - thresholds[i - 1]
          vi.advanceTimersByTime(advance)
          expect(deps.logger.warn).toHaveBeenCalledWith(
            'stream.chunk.gap_warning',
            expect.objectContaining({
              elapsedMs: thresholds[i],
              timeoutMs: TEST_TIMEOUT_MS,
            })
          )
        }

        expect(deps.abortController.abort)
          .not.toHaveBeenCalled()
      }
    )

    it(
      'fires all warnings then aborts at timeout',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(
          deps, TEST_TIMEOUT_MS
        )
        const thresholds =
          CHUNK_GAP_WARNING_THRESHOLDS_MS

        guard.arm()
        vi.advanceTimersByTime(LAST_THRESHOLD)

        expect(deps.logger.warn)
          .toHaveBeenCalledTimes(thresholds.length)
        expect(deps.abortController.abort)
          .not.toHaveBeenCalled()

        vi.advanceTimersByTime(
          TEST_TIMEOUT_MS - LAST_THRESHOLD
        )

        // All warnings + the timeout log
        expect(deps.logger.warn)
          .toHaveBeenCalledTimes(thresholds.length + 1)
        expect(deps.logger.warn)
          .toHaveBeenLastCalledWith(
            'stream.chunk.timeout.transport',
            expect.objectContaining({
              timeoutMs: TEST_TIMEOUT_MS,
            })
          )
        expect(deps.abortController.abort)
          .toHaveBeenCalledWith('chunk_timeout')
      }
    )

    it(
      'does not fire warnings when timeout is shorter ' +
      'than all thresholds',
      () => {
        const deps = makeDeps()
        const shortTimeout =
          CHUNK_GAP_WARNING_THRESHOLDS_MS[0] - 1_000
        const guard = new ChunkTimeoutGuard(
          deps, shortTimeout
        )

        guard.arm()
        vi.advanceTimersByTime(shortTimeout)

        expect(deps.logger.warn).not.toHaveBeenCalledWith(
          'stream.chunk.gap_warning',
          expect.anything()
        )
        expect(deps.abortController.abort)
          .toHaveBeenCalledWith('chunk_timeout')
      }
    )

    it(
      'fires only thresholds below custom timeout ' +
      '(partial suppression)',
      () => {
        const deps = makeDeps()
        // Timeout between the second and third threshold
        const midTimeout =
          CHUNK_GAP_WARNING_THRESHOLDS_MS[1] + 1_000
        const guard = new ChunkTimeoutGuard(
          deps, midTimeout
        )

        guard.arm()
        vi.advanceTimersByTime(midTimeout)

        const warnCalls = deps.logger.warn.mock.calls
        const gapWarnings = warnCalls.filter(
          ([event]: [string]) =>
            event === 'stream.chunk.gap_warning'
        )
        expect(gapWarnings).toHaveLength(2)
        expect(gapWarnings[0][1]).toEqual(
          expect.objectContaining({
            elapsedMs:
              CHUNK_GAP_WARNING_THRESHOLDS_MS[0],
          })
        )
        expect(gapWarnings[1][1]).toEqual(
          expect.objectContaining({
            elapsedMs:
              CHUNK_GAP_WARNING_THRESHOLDS_MS[1],
          })
        )
      }
    )

    it(
      'suppresses threshold at exact timeout boundary ' +
      '(>= guard)',
      () => {
        const deps = makeDeps()
        // Timeout exactly at the last threshold
        const guard = new ChunkTimeoutGuard(
          deps, LAST_THRESHOLD
        )

        guard.arm()
        vi.advanceTimersByTime(LAST_THRESHOLD)

        const warnCalls = deps.logger.warn.mock.calls
        const gapWarnings = warnCalls.filter(
          ([event]: [string]) =>
            event === 'stream.chunk.gap_warning'
        )
        // All thresholds except the last (>= guard)
        expect(gapWarnings).toHaveLength(
          CHUNK_GAP_WARNING_THRESHOLDS_MS.length - 1
        )
      }
    )

    it('reset() clears and reschedules warnings', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(
        deps, TEST_TIMEOUT_MS
      )
      const firstThreshold =
        CHUNK_GAP_WARNING_THRESHOLDS_MS[0]

      guard.arm()
      vi.advanceTimersByTime(Math.floor(firstThreshold / 2))
      guard.reset()

      vi.advanceTimersByTime(firstThreshold)
      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'stream.chunk.gap_warning',
        expect.objectContaining({
          elapsedMs: firstThreshold,
        })
      )
    })

    it('pause() clears pending warnings', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(
        deps, TEST_TIMEOUT_MS
      )

      guard.arm()
      guard.pause()
      vi.advanceTimersByTime(
        CHUNK_GAP_WARNING_THRESHOLDS_MS[0]
      )

      expect(deps.logger.warn)
        .not.toHaveBeenCalledWith(
          'stream.chunk.gap_warning',
          expect.anything()
        )
    })

    it('dispose() clears pending warnings', () => {
      const deps = makeDeps()
      const guard = new ChunkTimeoutGuard(
        deps, TEST_TIMEOUT_MS
      )
      const firstThreshold =
        CHUNK_GAP_WARNING_THRESHOLDS_MS[0]

      guard.arm()
      vi.advanceTimersByTime(
        Math.floor(firstThreshold / 2)
      )
      guard.dispose()
      vi.advanceTimersByTime(firstThreshold)

      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        'stream.chunk.gap_warning',
        expect.anything()
      )
    })

    it(
      'skips warnings when signal is already aborted',
      () => {
        const deps = makeDeps({ aborted: true })
        const guard = new ChunkTimeoutGuard(
          deps, TEST_TIMEOUT_MS
        )

        guard.arm()
        vi.advanceTimersByTime(
          CHUNK_GAP_WARNING_THRESHOLDS_MS[0]
        )

        expect(deps.logger.warn)
          .not.toHaveBeenCalled()
      }
    )

    it(
      'does not log warning if signal aborted ' +
      'before threshold fires',
      () => {
        const deps = makeDeps()
        const guard = new ChunkTimeoutGuard(
          deps, TEST_TIMEOUT_MS
        )
        const firstThreshold =
          CHUNK_GAP_WARNING_THRESHOLDS_MS[0]

        guard.arm()
        vi.advanceTimersByTime(firstThreshold - 10_000)
        ;(deps.abortController.signal as any)
          .aborted = true
        vi.advanceTimersByTime(10_000)

        expect(deps.logger.warn)
          .not.toHaveBeenCalledWith(
            'stream.chunk.gap_warning',
            expect.anything()
          )
      }
    )
  })
})
