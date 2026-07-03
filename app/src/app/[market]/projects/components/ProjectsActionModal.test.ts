/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'

import { isTextEntryElement, resolveTextEntryElement } from './ProjectsActionModal'

describe('isTextEntryElement', () => {
  it('returns true for an input element', () => {
    expect(isTextEntryElement(document.createElement('input'))).toBe(true)
  })

  it('returns true for a textarea element', () => {
    expect(isTextEntryElement(document.createElement('textarea'))).toBe(true)
  })

  it('returns true for an element nested inside a ux-text-input shell', () => {
    document.body.innerHTML = '<div class="ux-text-input"><span id="target">x</span></div>'
    expect(isTextEntryElement(document.getElementById('target')!)).toBe(true)
  })

  it('returns true for an element nested inside a ux-text-entry-shell', () => {
    document.body.innerHTML = '<div class="ux-text-entry-shell"><span id="target">x</span></div>'
    expect(isTextEntryElement(document.getElementById('target')!)).toBe(true)
  })

  it('returns true for a contenteditable element', () => {
    document.body.innerHTML = '<div contenteditable="true" id="target">x</div>'
    expect(isTextEntryElement(document.getElementById('target')!)).toBe(true)
  })

  it('returns true for an element nested inside a contenteditable element', () => {
    document.body.innerHTML = '<div contenteditable="true"><span id="target">x</span></div>'
    expect(isTextEntryElement(document.getElementById('target')!)).toBe(true)
  })

  it('returns false for a plain element with no text-entry ancestor', () => {
    document.body.innerHTML = '<div><span id="target">x</span></div>'
    expect(isTextEntryElement(document.getElementById('target')!)).toBe(false)
  })
})

describe('resolveTextEntryElement', () => {
  it('returns the element itself for an input element', () => {
    const input = document.createElement('input')
    expect(resolveTextEntryElement(input)).toBe(input)
  })

  it('returns the element itself for a textarea element', () => {
    const textarea = document.createElement('textarea')
    expect(resolveTextEntryElement(textarea)).toBe(textarea)
  })

  it('returns the closest ux-text-entry-shell ancestor for a nested element', () => {
    document.body.innerHTML = '<div class="ux-text-entry-shell" id="shell"><span id="target">x</span></div>'
    expect(resolveTextEntryElement(document.getElementById('target')!)).toBe(document.getElementById('shell'))
  })

  it('returns the closest ux-text-input ancestor for a nested element', () => {
    document.body.innerHTML = '<div class="ux-text-input" id="shell"><span id="target">x</span></div>'
    expect(resolveTextEntryElement(document.getElementById('target')!)).toBe(document.getElementById('shell'))
  })

  it('returns null for a contenteditable element with no shell ancestor', () => {
    document.body.innerHTML = '<div contenteditable="true" id="target">x</div>'
    expect(resolveTextEntryElement(document.getElementById('target')!)).toBeNull()
  })

  it('returns null when no text-entry ancestor exists', () => {
    document.body.innerHTML = '<div><span id="target">x</span></div>'
    expect(resolveTextEntryElement(document.getElementById('target')!)).toBeNull()
  })
})
