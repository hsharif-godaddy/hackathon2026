/**
 * @vitest-environment jsdom
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleModifierEnterNewline } from './textareaShortcuts'

describe('textareaShortcuts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
  })

  it('should return false for plain Enter', () => {
    const preventDefault = vi.fn()
    const onValueChange = vi.fn()
    const textarea = document.createElement('textarea')
    textarea.value = 'Test'

    const handled = handleModifierEnterNewline(
      {
        key: 'Enter',
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        currentTarget: textarea,
        preventDefault,
      } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>,
      {
        currentValue: 'Test',
        onValueChange,
      }
    )

    expect(handled).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('should insert a newline for Meta+Enter', () => {
    const preventDefault = vi.fn()
    const onValueChange = vi.fn()
    const textarea = document.createElement('textarea')
    textarea.value = 'Test'
    textarea.setSelectionRange(4, 4)

    const handled = handleModifierEnterNewline(
      {
        key: 'Enter',
        altKey: false,
        metaKey: true,
        ctrlKey: false,
        currentTarget: textarea,
        preventDefault,
      } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>,
      {
        currentValue: 'Test',
        onValueChange,
      }
    )

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onValueChange).toHaveBeenCalledWith('Test\n')
  })

  it('should insert a newline for Ctrl+Enter', () => {
    const preventDefault = vi.fn()
    const onValueChange = vi.fn()
    const textarea = document.createElement('textarea')
    textarea.value = 'Test'
    textarea.setSelectionRange(4, 4)

    const handled = handleModifierEnterNewline(
      {
        key: 'Enter',
        altKey: false,
        metaKey: false,
        ctrlKey: true,
        currentTarget: textarea,
        preventDefault,
      } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>,
      {
        currentValue: 'Test',
        onValueChange,
      }
    )

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onValueChange).toHaveBeenCalledWith('Test\n')
  })
})
