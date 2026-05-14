// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useToolDetailsModal, useToolDetailsModalStore } from '../useToolDetailsModalStore'

afterEach(() => {
  useToolDetailsModalStore.setState({ openToolId: null })
})

describe('useToolDetailsModalStore', () => {
  it('starts with no open tool', () => {
    expect(useToolDetailsModalStore.getState().openToolId).toBeNull()
  })

  it('sets and clears the open tool id', () => {
    useToolDetailsModalStore.getState().setOpenToolId('tool-a')
    expect(useToolDetailsModalStore.getState().openToolId).toBe('tool-a')

    useToolDetailsModalStore.getState().setOpenToolId(null)
    expect(useToolDetailsModalStore.getState().openToolId).toBeNull()
  })
})

describe('useToolDetailsModal', () => {
  it('reports closed when no tool is open', () => {
    const { result } = renderHook(() => useToolDetailsModal('tool-a'))
    const [isOpen] = result.current
    expect(isOpen).toBe(false)
  })

  it('reports open only for the matching tool id', () => {
    const a = renderHook(() => useToolDetailsModal('tool-a'))
    const b = renderHook(() => useToolDetailsModal('tool-b'))

    act(() => {
      a.result.current[1](true)
    })

    a.rerender()
    b.rerender()

    expect(a.result.current[0]).toBe(true)
    expect(b.result.current[0]).toBe(false)
  })

  it('opening a second tool closes the first', () => {
    const a = renderHook(() => useToolDetailsModal('tool-a'))
    const b = renderHook(() => useToolDetailsModal('tool-b'))

    act(() => {
      a.result.current[1](true)
    })
    a.rerender()
    expect(a.result.current[0]).toBe(true)

    act(() => {
      b.result.current[1](true)
    })
    a.rerender()
    b.rerender()
    expect(a.result.current[0]).toBe(false)
    expect(b.result.current[0]).toBe(true)
  })

  it('reports closed when toolId is undefined even if some other tool is open', () => {
    useToolDetailsModalStore.getState().setOpenToolId('tool-a')
    const { result } = renderHook(() => useToolDetailsModal(undefined))
    expect(result.current[0]).toBe(false)
  })

  it('setIsOpen(false) clears the store', () => {
    const { result } = renderHook(() => useToolDetailsModal('tool-a'))
    act(() => {
      result.current[1](true)
    })
    expect(useToolDetailsModalStore.getState().openToolId).toBe('tool-a')

    act(() => {
      result.current[1](false)
    })
    expect(useToolDetailsModalStore.getState().openToolId).toBeNull()
  })
})
