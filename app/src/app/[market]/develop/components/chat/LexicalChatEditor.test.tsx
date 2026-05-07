/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import LexicalChatEditor, { type LexicalChatEditorHandle } from './LexicalChatEditor'

const defaultProps = {
  inputValue: '',
  onInputChange: vi.fn(),
  onSubmit: vi.fn(),
  canSubmit: false,
  isDisabled: false,
  isStreaming: false,
  isBudgetExceeded: false,
  isListening: false,
  uploadingStagedFileIds: [] as readonly string[],
  canStageFiles: false,
  canAddAsset: false,
  placeholder: 'Ask Airo...',
  onArrowUp: vi.fn(() => false),
  onArrowDown: vi.fn(() => false),
  exitNavigationMode: vi.fn(),
}

function renderEditor(overrides: Partial<typeof defaultProps> = {}, ref?: React.RefObject<LexicalChatEditorHandle | null>) {
  const props = { ...defaultProps, ...overrides }
  return renderWithProviders(
    <LexicalChatEditor ref={ref} {...props} />
  )
}

describe('LexicalChatEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the contentEditable editor', () => {
    renderEditor()
    expect(screen.getByTestId('chat-input-textarea')).toBeInTheDocument()
  })

  it('renders placeholder text', () => {
    renderEditor({ placeholder: 'Type a message...' })
    expect(screen.getByText('Type a message...')).toBeInTheDocument()
  })

  it('calls onInputChange when text is typed', async () => {
    const onInputChange = vi.fn()
    const { user } = renderEditor({ onInputChange })
    const editor = screen.getByTestId('chat-input-textarea')
    await user.click(editor)
    await user.type(editor, 'hello')
    await waitFor(() => {
      expect(onInputChange).toHaveBeenCalled()
    })
  })

  it('calls onSubmit on Enter when canSubmit is true', async () => {
    const onSubmit = vi.fn()
    renderEditor({ onSubmit, canSubmit: true })
    const editor = screen.getByTestId('chat-input-textarea')
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' })
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })
  })

  it('does not call onSubmit on Enter when canSubmit is false', async () => {
    const onSubmit = vi.fn()
    renderEditor({ onSubmit, canSubmit: false })
    const editor = screen.getByTestId('chat-input-textarea')
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' })
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('does not call onSubmit on Shift+Enter', async () => {
    const onSubmit = vi.fn()
    renderEditor({ onSubmit, canSubmit: true })
    const editor = screen.getByTestId('chat-input-textarea')
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', shiftKey: true })
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('is not editable when disabled', async () => {
    renderEditor({ isDisabled: true })
    await waitFor(() => {
      const editor = screen.getByTestId('chat-input-textarea')
      expect(editor.getAttribute('contenteditable')).toBe('false')
    })
  })

  it('is not editable when budget exceeded', async () => {
    renderEditor({ isBudgetExceeded: true })
    await waitFor(() => {
      const editor = screen.getByTestId('chat-input-textarea')
      expect(editor.getAttribute('contenteditable')).toBe('false')
    })
  })

  describe('mention operations via ref', () => {
    it('insertElementMention adds a mention chip', async () => {
      const ref = createRef<LexicalChatEditorHandle>()
      renderEditor({}, ref)

      await waitFor(() => expect(ref.current).not.toBeNull())

      act(() => {
        ref.current!.insertElementMention(1, 'div')
      })

      await waitFor(() => {
        expect(screen.getByText('#1')).toBeInTheDocument()
        // 'div' has no friendly label so falls through to the raw tag name
        expect(screen.getByText('div')).toBeInTheDocument()
      })
    })

    it('removeElementMention removes a specific mention', async () => {
      const ref = createRef<LexicalChatEditorHandle>()
      renderEditor({}, ref)

      await waitFor(() => expect(ref.current).not.toBeNull())

      act(() => {
        ref.current!.insertElementMention(1, 'div')
        ref.current!.insertElementMention(2, 'h1')
      })

      await waitFor(() => {
        expect(screen.getByText('#1')).toBeInTheDocument()
        expect(screen.getByText('div')).toBeInTheDocument()
        expect(screen.getByText('#2')).toBeInTheDocument()
        expect(screen.getByText('Title')).toBeInTheDocument()
      })

      act(() => {
        ref.current!.removeElementMention(1)
      })

      await waitFor(() => {
        expect(screen.queryByText('#1')).not.toBeInTheDocument()
        expect(screen.getByText('#2')).toBeInTheDocument()
      })
    })

    it('clearAllElementMentions removes all mentions', async () => {
      const ref = createRef<LexicalChatEditorHandle>()
      renderEditor({}, ref)

      await waitFor(() => expect(ref.current).not.toBeNull())

      act(() => {
        ref.current!.insertElementMention(1, 'div')
        ref.current!.insertElementMention(2, 'h1')
      })

      await waitFor(() => {
        expect(screen.getByText('#1')).toBeInTheDocument()
        expect(screen.getByText('div')).toBeInTheDocument()
        expect(screen.getByText('#2')).toBeInTheDocument()
        expect(screen.getByText('Title')).toBeInTheDocument()
      })

      act(() => {
        ref.current!.clearAllElementMentions()
      })

      await waitFor(() => {
        expect(screen.queryByText('#1')).not.toBeInTheDocument()
        expect(screen.queryByText('div')).not.toBeInTheDocument()
        expect(screen.queryByText('#2')).not.toBeInTheDocument()
        expect(screen.queryByText('Title')).not.toBeInTheDocument()
      })
    })
  })

  describe('onMentionRemoved callback', () => {
    it('fires when a mention is removed via ref', async () => {
      const onMentionRemoved = vi.fn()
      const ref = createRef<LexicalChatEditorHandle>()
      renderEditor({ onMentionRemoved }, ref)

      await waitFor(() => expect(ref.current).not.toBeNull())

      act(() => {
        ref.current!.insertElementMention(1, 'div')
      })

      await waitFor(() => {
        expect(screen.getByText('#1')).toBeInTheDocument()
        expect(screen.getByText('div')).toBeInTheDocument()
      })

      act(() => {
        ref.current!.removeElementMention(1)
      })

      await waitFor(() => {
        expect(onMentionRemoved).toHaveBeenCalledWith(1)
        expect(screen.queryByText('#1')).not.toBeInTheDocument()
        expect(screen.queryByText('div')).not.toBeInTheDocument()
      })
    })
  })

  describe('remove-mention custom event', () => {
    it('removes mention when custom event is dispatched', async () => {
      const ref = createRef<LexicalChatEditorHandle>()
      renderEditor({}, ref)

      await waitFor(() => expect(ref.current).not.toBeNull())

      act(() => {
        ref.current!.insertElementMention(1, 'div')
      })

      await waitFor(() => {
        expect(screen.getByText('#1')).toBeInTheDocument()
      })

      act(() => {
        document.dispatchEvent(new CustomEvent('remove-mention', {
          detail: { value: '1 <div>', mentionAttr: '#1 <div>' }
        }))
      })

      await waitFor(() => {
        expect(screen.queryByText('#1')).not.toBeInTheDocument()
      })
    })
  })

  describe('mention chip X button', () => {
    it('renders remove button on mention chips', async () => {
      const ref = createRef<LexicalChatEditorHandle>()
      renderEditor({}, ref)

      await waitFor(() => expect(ref.current).not.toBeNull())

      act(() => {
        ref.current!.insertElementMention(1, 'div')
      })

      await waitFor(() => {
        const removeBtn = screen.getByRole('button', { name: 'Remove' })
        expect(removeBtn).toBeInTheDocument()
      })
    })
  })

  describe('large paste detection', () => {
    it('calls onLargePasteDetected for text over 4000 chars', async () => {
      const onLargePasteDetected = vi.fn()
      renderEditor({ onLargePasteDetected })
      const editor = screen.getByTestId('chat-input-textarea')

      const largeText = 'x'.repeat(5000)
      const data: Record<string, string> = { 'text/plain': largeText }
      const clipboardData = {
        getData: (type: string) => data[type] ?? '',
        setData: (type: string, value: string) => { data[type] = value },
        items: [],
      }

      fireEvent.paste(editor, { clipboardData })

      await waitFor(() => {
        expect(onLargePasteDetected).toHaveBeenCalledWith(largeText)
      })
    })
  })
})
