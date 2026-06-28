import { describe, expect, it } from 'vitest'

import { FaultController, isFaultName, isPreStreamFault } from '../faults.js'

describe('FaultController', () => {
  it('defaults to count 1 and chat scope', () => {
    const controller: FaultController = new FaultController()
    const state = controller.arm({ fault: 'premature-close' })
    expect(state).toMatchObject({ fault: 'premature-close', remaining: 1, scope: 'chat' })
  })

  it('claims a chat request and auto-disarms when the count reaches zero', () => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'http-error' })
    const claim = controller.claim(true)
    expect(claim?.fault).toBe('http-error')
    expect(claim?.autoDisarmed).toBe(true)
    expect(controller.snapshot()).toBeNull()
  })

  it('does not consume the count for out-of-scope (non-chat) requests', () => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'http-error', scope: 'chat' })
    expect(controller.claim(false)).toBeNull()
    expect(controller.snapshot()?.remaining).toBe(1)
  })

  it('claims non-chat requests when scope is all', () => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'http-error', scope: 'all' })
    expect(controller.claim(false)?.fault).toBe('http-error')
  })

  it('auto-disarms only after N matching requests', () => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'invalid-chunk', count: 3, scope: 'all' })
    expect(controller.claim(true)?.autoDisarmed).toBe(false)
    expect(controller.claim(true)?.autoDisarmed).toBe(false)
    expect(controller.claim(true)?.autoDisarmed).toBe(true)
    expect(controller.claim(true)).toBeNull()
  })

  it('returns isolated snapshots (mutation does not leak)', () => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'invalid-chunk', count: 2, params: { afterChunks: 5 }, scope: 'all' })
    const snapshot = controller.snapshot()
    controller.claim(true)
    expect(snapshot?.remaining).toBe(2)
    expect(snapshot?.params.afterChunks).toBe(5)
  })

  it('disarms manually', () => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'connection-reset' })
    controller.disarm()
    expect(controller.snapshot()).toBeNull()
  })
})

describe('fault predicates', () => {
  it('recognizes catalog names', () => {
    expect(isFaultName('premature-close')).toBe(true)
    expect(isFaultName('nope')).toBe(false)
    expect(isFaultName(42)).toBe(false)
  })

  it('classifies pre-stream faults', () => {
    expect(isPreStreamFault('http-error')).toBe(true)
    expect(isPreStreamFault('connection-reset')).toBe(true)
    expect(isPreStreamFault('premature-close')).toBe(false)
  })
})
