import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_SEND_ATTEMPTS, REBUILD_BATCH_CAP, useRebuildBuildQueue } from './useRebuildBuildQueue'

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const reset = () => useRebuildBuildQueue.getState().stop()
const state = () => useRebuildBuildQueue.getState()

describe('useRebuildBuildQueue', () => {
  beforeEach(reset)

  it('enqueue starts a running batch at cursor 0', () => {
    state().enqueue(['a', 'b'])
    expect(state().status).toBe('running')
    expect(state().slugs).toEqual(['a', 'b'])
    expect(state().cursor).toBe(0)
    expect(state().phase).toBe('awaiting-send')
  })

  it('enqueue truncates to REBUILD_BATCH_CAP', () => {
    const many = Array.from({ length: REBUILD_BATCH_CAP + 3 }, (_, i) => `p${i}`)
    state().enqueue(many)
    expect(state().slugs).toHaveLength(REBUILD_BATCH_CAP)
  })

  it('enqueue with no slugs is a no-op', () => {
    state().enqueue([])
    expect(state().status).toBe('idle')
  })

  it('enqueue is ignored while a batch is already running (no clobber)', () => {
    state().enqueue(['a', 'b'])
    state().markSent()
    state().onProcessingChange(true) // in-turn on page a
    state().enqueue(['x', 'y', 'z']) // should be ignored
    expect(state().slugs).toEqual(['a', 'b'])
    expect(state().cursor).toBe(0)
    expect(state().phase).toBe('in-turn')
  })

  it('advances through the queue on send→turn-start→turn-end, then returns to idle', () => {
    state().enqueue(['a', 'b'])
    state().markSent()
    state().onProcessingChange(true)
    expect(state().phase).toBe('in-turn')
    state().onProcessingChange(false)
    expect(state().cursor).toBe(1)
    expect(state().phase).toBe('awaiting-send')
    state().markSent()
    state().onProcessingChange(true)
    state().onProcessingChange(false)
    expect(state().status).toBe('idle')
    expect(state().slugs).toEqual([])
  })

  it('stops (clears) when a turn starts while still awaiting send — manual interjection', () => {
    state().enqueue(['a', 'b'])
    state().onProcessingChange(true)
    expect(state().status).toBe('idle')
    expect(state().slugs).toEqual([])
  })

  it('stop() clears a running batch', () => {
    state().enqueue(['a', 'b'])
    state().stop()
    expect(state().status).toBe('idle')
    expect(state().slugs).toEqual([])
  })

  it('onProcessingChange is a no-op when idle', () => {
    state().onProcessingChange(true)
    state().onProcessingChange(false)
    expect(state().status).toBe('idle')
  })

  it('onSendStalled retries (re-arms send) before MAX_SEND_ATTEMPTS, then gives up', () => {
    state().enqueue(['a', 'b'])
    // Stall the page repeatedly: each markSent → stall re-arms until the cap.
    for (let i = 1; i < MAX_SEND_ATTEMPTS; i++) {
      state().markSent()
      expect(state().phase).toBe('sent')
      state().onSendStalled()
      expect(state().phase).toBe('awaiting-send') // retried
      expect(state().attempts).toBe(i)
    }
    // Final attempt stalls → give up the whole batch (don't freeze).
    state().markSent()
    state().onSendStalled()
    expect(state().status).toBe('idle')
    expect(state().slugs).toEqual([])
  })

  it('resets the attempt counter once a turn starts', () => {
    state().enqueue(['a', 'b'])
    state().markSent()
    state().onSendStalled() // 1 stall on page a
    expect(state().attempts).toBe(1)
    state().markSent()
    state().onProcessingChange(true) // turn finally starts
    expect(state().attempts).toBe(0)
  })

  it('onSendStalled is a no-op once the turn has started (stale watchdog)', () => {
    state().enqueue(['a'])
    state().markSent()
    state().onProcessingChange(true) // phase → in-turn
    state().onSendStalled() // stale timer fires after the turn already started
    expect(state().phase).toBe('in-turn')
    expect(state().status).toBe('running')
  })
})
