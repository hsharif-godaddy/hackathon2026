/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { createRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  isChatPromptEffectivelyEmpty,
  isNonChatTextEntryActive,
  shouldAllowChoiceListDigitShortcut,
} from '../shortcutFocus'

describe('shortcutFocus', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('allows shortcut when main chat prompt is focused and empty', () => {
    const prompt = document.createElement('div')
    prompt.id = 'chat-input-textarea'
    prompt.setAttribute('contenteditable', 'true')
    document.body.append(prompt)
    prompt.focus()

    expect(isChatPromptEffectivelyEmpty()).toBe(true)
    expect(shouldAllowChoiceListDigitShortcut(prompt)).toBe(true)
  })

  it('blocks shortcut when chat prompt has text', () => {
    const prompt = document.createElement('div')
    prompt.id = 'chat-input-textarea'
    prompt.setAttribute('contenteditable', 'true')
    prompt.innerText = 'I mean number 3'
    document.body.append(prompt)
    prompt.focus()

    expect(isChatPromptEffectivelyEmpty()).toBe(false)
    expect(shouldAllowChoiceListDigitShortcut(prompt)).toBe(false)
  })

  it('allows shortcut when focus is inside listbox under data-chat-composer-card', () => {
    const card = document.createElement('div')
    card.setAttribute('data-chat-composer-card', '')
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    const opt = document.createElement('button')
    opt.setAttribute('role', 'option')
    listbox.append(opt)
    card.append(listbox)
    document.body.append(card)
    opt.focus()

    expect(shouldAllowChoiceListDigitShortcut(opt)).toBe(true)
  })

  it('blocks shortcut when listbox is under chat-input-card test id but lacks composer marker', () => {
    const card = document.createElement('div')
    card.setAttribute('data-testid', 'chat-input-card')
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    const opt = document.createElement('button')
    opt.setAttribute('role', 'option')
    listbox.append(opt)
    card.append(listbox)
    document.body.append(card)
    opt.focus()

    expect(shouldAllowChoiceListDigitShortcut(opt)).toBe(false)
  })

  it('allows shortcut when focus is inside choiceListContainerRef subtree', () => {
    const container = document.createElement('div')
    const inner = document.createElement('button')
    container.append(inner)
    document.body.append(container)
    const ref = createRef<HTMLDivElement>()
    ref.current = container
    inner.focus()

    expect(shouldAllowChoiceListDigitShortcut(inner, ref)).toBe(true)
  })

  it('blocks shortcut when choiceListContainerRef is unset', () => {
    const orphan = document.createElement('button')
    document.body.append(orphan)
    orphan.focus()
    const emptyRef = createRef<HTMLDivElement>()

    expect(shouldAllowChoiceListDigitShortcut(orphan, emptyRef)).toBe(false)
  })

  it('blocks shortcut when focus is outside card and not empty chat', () => {
    const opt = document.createElement('button')
    opt.setAttribute('role', 'option')
    document.body.append(opt)
    opt.focus()

    expect(shouldAllowChoiceListDigitShortcut(opt)).toBe(false)
  })

  it('isNonChatTextEntryActive is true for stray INPUT', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(isNonChatTextEntryActive(input)).toBe(true)
  })
})
