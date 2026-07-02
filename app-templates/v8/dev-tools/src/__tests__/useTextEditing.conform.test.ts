// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { handleConformReply, type PendingConform } from '../hooks/useTextEditing'

function makePend(selector: string = '#my-el'): PendingConform {
  return { page: 'index', arrayName: 'features', selector }
}

describe('handleConformReply', () => {
  it('CONFORM_SUCCEEDED: calls waitForContentBackedFn with selector and clears ref', () => {
    const ref: { current: PendingConform | null } = { current: makePend('#hero') }
    const startEditing = vi.fn()
    const waitForContentBackedFn = vi.fn((_sel: string, _cb: (el: HTMLElement) => void, _t: number): (() => void) => () => {})

    handleConformReply('CONFORM_SUCCEEDED', ref, startEditing, waitForContentBackedFn, true)

    expect(waitForContentBackedFn).toHaveBeenCalledTimes(1)
    expect(waitForContentBackedFn.mock.calls[0][0]).toBe('#hero')
    expect(typeof waitForContentBackedFn.mock.calls[0][1]).toBe('function')
    expect(waitForContentBackedFn.mock.calls[0][2]).toBe(4000)
    expect(ref.current).toBeNull()
  })

  it('CONFORM_SUCCEEDED: callback passed to waitForContentBackedFn invokes startEditing', () => {
    const ref: { current: PendingConform | null } = { current: makePend('#hero') }
    const startEditing = vi.fn()
    const waitForContentBackedFn = vi.fn((_sel: string, _cb: (el: HTMLElement) => void, _t: number): (() => void) => () => {})

    handleConformReply('CONFORM_SUCCEEDED', ref, startEditing, waitForContentBackedFn, true)

    const cb = waitForContentBackedFn.mock.calls[0][1] as (el: HTMLElement) => void
    const el: HTMLElement = document.createElement('div')
    cb(el)
    expect(startEditing).toHaveBeenCalledWith(el)
  })

  it('CONFORM_SUCCEEDED with null ref: waitForContentBackedFn not called, ref stays null', () => {
    const ref: { current: PendingConform | null } = { current: null }
    const startEditing = vi.fn()
    const waitForContentBackedFn = vi.fn((_sel: string, _cb: (el: HTMLElement) => void, _t: number): (() => void) => () => {})

    handleConformReply('CONFORM_SUCCEEDED', ref, startEditing, waitForContentBackedFn, true)

    expect(waitForContentBackedFn).not.toHaveBeenCalled()
    expect(startEditing).not.toHaveBeenCalled()
    expect(ref.current).toBeNull()
  })

  it('CONFORM_FAILED: startEditing not called, ref cleared', () => {
    const ref: { current: PendingConform | null } = { current: makePend('#cta') }
    const startEditing = vi.fn()
    const waitForContentBackedFn = vi.fn((_sel: string, _cb: (el: HTMLElement) => void, _t: number): (() => void) => () => {})

    handleConformReply('CONFORM_FAILED', ref, startEditing, waitForContentBackedFn, true)

    expect(startEditing).not.toHaveBeenCalled()
    expect(waitForContentBackedFn).not.toHaveBeenCalled()
    expect(ref.current).toBeNull()
  })

  it('unknown event type: neither fn called, ref unchanged', () => {
    const pend: PendingConform = makePend('#card')
    const ref: { current: PendingConform | null } = { current: pend }
    const startEditing = vi.fn()
    const waitForContentBackedFn = vi.fn((_sel: string, _cb: (el: HTMLElement) => void, _t: number): (() => void) => () => {})

    handleConformReply('TEXT_EDIT_SUCCEEDED', ref, startEditing, waitForContentBackedFn, true)

    expect(startEditing).not.toHaveBeenCalled()
    expect(waitForContentBackedFn).not.toHaveBeenCalled()
    expect(ref.current).toBe(pend)
  })
})
