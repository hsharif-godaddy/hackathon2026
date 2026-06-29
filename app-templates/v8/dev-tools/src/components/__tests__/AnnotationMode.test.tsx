/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}))

const sendMock = vi.fn()
vi.mock('../../utils/eventBus', () => ({
  send: (...args: unknown[]) => sendMock(...args),
}))

vi.mock('../../utils/postMessage', () => ({
  isOriginAllowed: vi.fn(() => true),
}))

import AnnotationMode from '../AnnotationMode'

function getOverlay(): SVGSVGElement {
  const overlay = document.querySelector('[data-airo-annotation-overlay="true"]') as SVGSVGElement | null
  if (!overlay) throw new Error('annotation overlay not found')
  return overlay
}

function getQuickEditInput(): HTMLInputElement {
  const input = document.querySelector('input[type="text"]') as HTMLInputElement | null
  if (!input) throw new Error('quick edit input not found')
  return input
}

function dragSelection(
  overlay: SVGSVGElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  overlay.setPointerCapture = vi.fn()
  overlay.releasePointerCapture = vi.fn()
  fireEvent.pointerDown(overlay, { clientX: fromX, clientY: fromY, button: 0, pointerId: 1 })
  fireEvent.pointerMove(overlay, { clientX: toX, clientY: toY, pointerId: 1 })
  fireEvent.pointerUp(overlay, { clientX: toX, clientY: toY, pointerId: 1 })
}

function submitQuickEdit(prompt: string): void {
  const input = getQuickEditInput()
  fireEvent.change(input, { target: { value: prompt } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

beforeEach(function setup() {
  cleanup()
  vi.clearAllMocks()
  document.body.innerHTML = ''
  Object.defineProperty(document.documentElement, 'scrollWidth', { value: 1000, configurable: true })
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true })
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
  window.scrollTo = vi.fn()
})

describe('AnnotationMode', function annotationModeTests() {
  it('emits ANNOTATION_SELECTION_CREATED after drag and QuickEditBar submit', function dragSubmit() {
    render(createElement(AnnotationMode, { isActive: true }))

    dragSelection(getOverlay(), 10, 10, 110, 110)
    submitQuickEdit('fix this area')

    expect(sendMock).toHaveBeenCalledWith({
      type: 'ANNOTATION_SELECTION_CREATED',
      data: {
        number: 1,
        rect: { x: 10, y: 10, width: 100, height: 100 },
        prompt: 'fix this area',
      },
    })
  })

  it('emits REMOVE_SELECTION_FROM_PREVIEW when the number badge is clicked', function badgeRemove() {
    render(createElement(AnnotationMode, { isActive: true }))

    dragSelection(getOverlay(), 10, 10, 60, 60)
    submitQuickEdit('remove me')

    const badge = document.querySelector('[data-airo-dev-tools=""]') as HTMLElement | null
    if (!badge) throw new Error('selection badge not found')
    fireEvent.click(badge)

    expect(sendMock).toHaveBeenCalledWith({
      type: 'REMOVE_SELECTION_FROM_PREVIEW',
      data: { number: 1 },
    })
    expect(document.querySelectorAll('[data-airo-annotation-overlay="true"] rect')).toHaveLength(0)
  })

  it('removes a selection when REMOVE_SELECTION is posted from parent', function removeSelection() {
    render(createElement(AnnotationMode, { isActive: true }))

    dragSelection(getOverlay(), 10, 10, 60, 60)
    submitQuickEdit('first')

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'REMOVE_SELECTION', data: { number: 1 } },
      source: window,
    }))

    expect(document.querySelectorAll('[data-airo-annotation-overlay="true"] rect')).toHaveLength(0)
  })

  it('clears all selections on CLEAR_ALL_SELECTIONS', function clearAll() {
    render(createElement(AnnotationMode, { isActive: true }))

    dragSelection(getOverlay(), 10, 10, 60, 60)
    submitQuickEdit('first')

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'CLEAR_ALL_SELECTIONS' },
      source: window,
    }))

    expect(document.querySelectorAll('[data-airo-annotation-overlay="true"] rect')).toHaveLength(0)
  })

  it('scrolls to a selection on SCROLL_TO_SELECTION', function scrollToSelection() {
    render(createElement(AnnotationMode, { isActive: true }))

    dragSelection(getOverlay(), 10, 300, 60, 360)
    submitQuickEdit('scroll target')

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'SCROLL_TO_SELECTION', data: { number: 1 } },
      source: window,
    }))

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 130,
      behavior: 'smooth',
    })
  })
})
