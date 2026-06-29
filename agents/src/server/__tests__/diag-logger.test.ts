import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { diag } from '@opentelemetry/api'

import { installDedupingDiagLogger } from '../diag-logger.js'

describe('installDedupingDiagLogger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    diag.disable()
    vi.useRealTimers()
  })

  it('emits the first occurrence of a signature, suppresses repeats within the window', () => {
    const sink = vi.fn()
    installDedupingDiagLogger(sink)

    diag.warn('Export failed with status 500')
    diag.warn('Export failed with status 500')
    diag.warn('Export failed with status 500')

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith('warn', expect.objectContaining({ suppressedSinceLast: 0 }))
  })

  it('collapses messages that differ only by digits/hashes to one signature', () => {
    const sink = vi.fn()
    installDedupingDiagLogger(sink)

    diag.warn('Export failed with status 500')
    diag.warn('Export failed with status 503')

    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('re-emits after the dedupe window and reports how many were suppressed', () => {
    const sink = vi.fn()
    installDedupingDiagLogger(sink)

    diag.error('Forbidden 403')
    diag.error('Forbidden 403')
    diag.error('Forbidden 403')
    expect(sink).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    diag.error('Forbidden 403')

    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenLastCalledWith('error', expect.objectContaining({ suppressedSinceLast: 2 }))
  })

  it('does not emit below the configured log level (debug suppressed at INFO)', () => {
    const sink = vi.fn()
    installDedupingDiagLogger(sink)

    diag.debug('verbose internals')

    expect(sink).not.toHaveBeenCalled()
  })
})
