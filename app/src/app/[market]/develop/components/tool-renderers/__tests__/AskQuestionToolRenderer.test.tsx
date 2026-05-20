/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach,describe, expect, it, vi } from 'vitest'
import { fireEvent,render, screen } from '@testing-library/react'

import AskQuestionToolRenderer from '../AskQuestionToolRenderer'

// Mock dependencies
const mockSendUserMessage = vi.fn()
vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => mockSendUserMessage,
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}))
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('@/utils/instrumentation', () => ({
  logAiroHQEvent: () => () => {},
}))

// Mock framer-motion to render children immediately
vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// Mock @ux/box
vi.mock('@ux/box', () => ({
  default: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

// Mock @ux/icon/arrow-right
vi.mock('@ux/icon/arrow-right', () => ({
  default: (props: any) => <span data-testid="arrow-right-icon" {...props} />,
}))

function makeResult(questions: any[], currentQuestionIndex = 0) {
  return {
    output: {
      widgetData: {
        questions,
        currentQuestionIndex,
        answers: [],
      },
    },
  }
}

function makeQuestion(
  question: string,
  suggestions: { text: string; value?: string }[],
  allowOther?: boolean,
) {
  return { question, suggestions, ...(allowOther !== undefined ? { allowOther } : {}) }
}

const defaultProps = {
  toolName: 'askQuestion',
  toolStatus: 'completed' as const,
  input: {},
  error: undefined,
  isLastAssistantMessage: true,
}

describe('AskQuestionToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom lacks scrollIntoView, which @ux/listbox calls when an option
    // becomes focused. Stub once so any test that focuses an option directly
    // (e.g. the digit-shortcut path) doesn't blow up unmounting the component.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('returns null when toolStatus is not completed', () => {
    const result = makeResult([makeQuestion('What color?', [{ text: 'Red' }])])
    const { container } = render(
      <AskQuestionToolRenderer
        {...defaultProps}
        toolStatus="running"
        result={result}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when no result', () => {
    const { container } = render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={undefined}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when isLastAssistantMessage is false', () => {
    const result = makeResult([makeQuestion('What color?', [{ text: 'Red' }])])
    const { container } = render(
      <AskQuestionToolRenderer
        {...defaultProps}
        isLastAssistantMessage={false}
        result={result}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('single question: clicking a suggestion sends the answer directly', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }, { text: 'Blue' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByText('What color?')).toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Blue')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Red'))

    expect(mockSendUserMessage).toHaveBeenCalledWith('Red', { isActionRequest: true })
  })

  it('multi-question: clicking suggestions advances through questions then sends formatted message', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }, { text: 'Blue' }]),
      makeQuestion('What size?', [{ text: 'Small' }, { text: 'Large' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    // First question visible
    expect(screen.getByText('What color?')).toBeInTheDocument()

    // Click first answer
    fireEvent.click(screen.getByText('Red'))

    // Should NOT have sent message yet (still have question 2)
    expect(mockSendUserMessage).not.toHaveBeenCalled()

    // Second question visible
    expect(screen.getByText('What size?')).toBeInTheDocument()

    // Click second answer
    fireEvent.click(screen.getByText('Large'))

    // Should have sent formatted message with both answers
    expect(mockSendUserMessage).toHaveBeenCalledWith(
      '1) What color?\nRed\n\n2) What size?\nLarge',
      { isActionRequest: true },
    )
  })

  it('allowOther: false hides the Other input', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }], false),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('allowOther: true (default) shows Other input and pressing Enter sends freeform as answer', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'Green' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockSendUserMessage).toHaveBeenCalledWith('Green', { isActionRequest: true })
  })

  it('question counter shows "1/2" for multi-question', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }]),
      makeQuestion('What size?', [{ text: 'Small' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('after all questions answered (isSubmitted), returns null', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }]),
    ])
    const { container } = render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    // Answer the only question
    fireEvent.click(screen.getByText('Red'))

    // Component should now render null
    expect(container.innerHTML).toBe('')
  })

  it('onComplete callback fires when all questions are answered', () => {
    const onComplete = vi.fn()
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
        onComplete={onComplete}
      />,
    )

    fireEvent.click(screen.getByText('Red'))

    expect(onComplete).toHaveBeenCalled()
  })

  it('Enter key in Other input submits the answer', () => {
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Purple' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockSendUserMessage).toHaveBeenCalledWith('Purple', { isActionRequest: true })
  })

  it('suggestion with value property sends value instead of text', () => {
    const result = makeResult([
      makeQuestion('What color?', [
        { text: 'Blue', value: 'color_blue' },
        { text: 'Red' },
      ]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    fireEvent.click(screen.getByText('Blue'))

    expect(mockSendUserMessage).toHaveBeenCalledWith('color_blue', { isActionRequest: true })
  })

  it('renders subtitle below the question when present', () => {
    const result = makeResult([{
      question: 'Any extra details?',
      subtitle: "If you have one in mind. Otherwise I'll invent.",
      suggestions: [{ text: 'Skip' }],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByText("If you have one in mind. Otherwise I'll invent.")).toBeInTheDocument()
  })

  it("type 'text' hides the suggestion buttons and renders input only", () => {
    const result = makeResult([{
      question: 'Your brand name?',
      type: 'text',
      placeholder: 'Your answer...',
      suggestions: [],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByText('Your brand name?')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Your answer...')).toBeInTheDocument()
    expect(screen.queryAllByRole('button').filter(b => b.textContent && b.textContent !== '').length).toBeLessThanOrEqual(1)
  })

  it("type 'text' submits input value as the answer", () => {
    const result = makeResult([{
      question: 'Your brand name?',
      type: 'text',
      placeholder: 'Your answer...',
      suggestions: [],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const input = screen.getByPlaceholderText('Your answer...')
    fireEvent.change(input, { target: { value: 'Sweet Rise' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockSendUserMessage).toHaveBeenCalledWith('Sweet Rise', { isActionRequest: true })
  })

  it('forwards question.placeholder to the free-text input', () => {
    const result = makeResult([{
      question: 'Anything else?',
      placeholder: 'Tell me more...',
      suggestions: [{ text: 'Skip' }],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByPlaceholderText('Tell me more...')).toBeInTheDocument()
  })

  it('bare-digit "Other" answer in range resolves to the chip\'s value', () => {
    // Aligned with #3558: a bare digit typed into Other is treated as a
    // pick of suggestion[N-1] (1-based to match the keyboard-shortcut UX).
    // The user's "2" is rewritten to the chip text/value, NOT preserved
    // literally. Out-of-range and non-numeric inputs still round-trip raw
    // (covered separately).
    const result = makeResult([{
      question: 'How many?',
      suggestions: [
        { text: 'One' },
        { text: 'Few' },
        { text: 'Many' },
      ],
      allowOther: true,
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // 1-based: typing "2" picks suggestions[1] = "Few", same as pressing
    // the digit key 2 or clicking the second chip.
    expect(mockSendUserMessage).toHaveBeenCalledWith('Few', { isActionRequest: true })
  })

  it('out-of-range bare-digit "Other" answer round-trips literally', () => {
    const result = makeResult([{
      question: 'How many?',
      suggestions: [{ text: 'One' }, { text: 'Few' }],
      allowOther: true,
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(mockSendUserMessage).toHaveBeenCalledWith('9', { isActionRequest: true })
  })

  it('skip → "Decide for me" text when every chip step offers the sentinel (useDecideAsSkip=true)', () => {
    // Two chip-only questions, each with a "Decide for me" sentinel → the
    // ChoiceList skip button becomes "Decide for me", and skipping emits the
    // chip's user-facing text into the message (not the raw `__decide__`
    // sentinel value, which would render as gibberish in the chat).
    const result = makeResult([
      {
        question: 'Vibe?',
        type: 'chips_single',
        suggestions: [
          { text: 'Cozy' },
          { text: 'Decide for me', value: '__decide__' },
        ],
      },
      {
        question: 'Palette?',
        type: 'chips_single',
        suggestions: [
          { text: 'Warm earth' },
          { text: 'Decide for me', value: '__decide__' },
        ],
      },
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    // Skip advances; skip on the last step completes.
    const skipButtons = screen.getAllByRole('button', { name: /Decide for me/i })
    fireEvent.click(skipButtons[0])
    const skipAgain = screen.getByRole('button', { name: /Decide for me/i })
    fireEvent.click(skipAgain)

    expect(mockSendUserMessage).toHaveBeenCalledTimes(1)
    const [msg] = mockSendUserMessage.mock.calls[0]
    expect(msg).not.toMatch(/__decide__/)
    expect(msg.match(/Decide for me/g)?.length).toBe(2)
  })

  it('"Decide for me" applies to text steps too in the prompt-enhancer flow', () => {
    // Regression for the prompt-enhancer variant: the agent emits chip
    // questions with the decide sentinel followed by trailing text questions
    // (LOCATION / KEY DETAILS / NAMING). When useDecideAsSkip is true, the
    // skip label must read "Decide for me" on every step AND skipping a
    // text step must emit "Decide for me" into the assembled message — not
    // blank. Otherwise the enhancer's omit-skipped-fields rule would drop
    // the field, breaking the button's promise to the user.
    const result = makeResult([
      {
        question: 'Vibe?',
        type: 'chips_single',
        suggestions: [
          { text: 'Cozy' },
          { text: 'Decide for me', value: '__decide__' },
        ],
      },
      {
        question: 'Where is the shop located?',
        type: 'text',
        suggestions: [],
      },
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByRole('button', { name: /Decide for me/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Skip$/i })).not.toBeInTheDocument()

    // Skip both steps and confirm both produce "Decide for me" in the message.
    const skip1 = screen.getByRole('button', { name: /Decide for me/i })
    fireEvent.click(skip1)
    const skip2 = screen.getByRole('button', { name: /Decide for me/i })
    fireEvent.click(skip2)

    expect(mockSendUserMessage).toHaveBeenCalledTimes(1)
    const [msg] = mockSendUserMessage.mock.calls[0]
    expect(msg.match(/Decide for me/g)?.length).toBe(2)
    expect(msg).not.toMatch(/__decide__/)
  })

  it('skip → blank when any chip step lacks the sentinel (useDecideAsSkip=false)', () => {
    // Two chip questions; only the first has a decide sentinel. The skip
    // button stays labeled "Skip" and records blank for each answer — so
    // the final message filters out empty entries entirely.
    const result = makeResult([
      {
        question: 'Vibe?',
        type: 'chips_single',
        suggestions: [
          { text: 'Cozy' },
          { text: 'Decide for me', value: '__decide__' },
        ],
      },
      {
        question: 'Hero?',
        type: 'chips_single',
        suggestions: [{ text: 'Photo' }, { text: 'Illustration' }],
      },
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const skip1 = screen.getByRole('button', { name: /^Skip$/i })
    fireEvent.click(skip1)
    const skip2 = screen.getByRole('button', { name: /^Skip$/i })
    fireEvent.click(skip2)

    expect(mockSendUserMessage).toHaveBeenCalledTimes(1)
    const [msg] = mockSendUserMessage.mock.calls[0]
    expect(msg).not.toMatch(/__decide__/)
    // All questions skipped → filter drops them → empty string.
    expect(msg).toBe('')
  })

  it('digit press on focused Other input does not trigger a ChoiceList pick', async () => {
    // Regression: a user who has clicked into the freeform "Other" input is
    // about to type a custom answer (which may legitimately start with a
    // digit). The window-level digit shortcut must not steal that keystroke
    // — even when the field is still empty. The previous behavior ran a
    // direct `onSelect` for empty fields, which surprised users who'd
    // deliberately moved focus to the input.
    const result = makeResult([
      makeQuestion('Pick?', [{ text: 'Red' }, { text: 'Blue' }, { text: 'Green' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const otherInput = screen.getByRole('textbox') as HTMLInputElement
    otherInput.focus()
    expect(otherInput.value).toBe('')

    fireEvent.keyDown(window, { key: '2' })
    await new Promise((r) => setTimeout(r, 0))

    // Listener bailed out — focus stays on the Other input, not the listbox
    // (which would mean the digit shortcut had hijacked the keystroke).
    expect(otherInput).toHaveFocus()
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })

  it('Other input keeps typed text across parent re-renders with the same result', () => {
    // Regression: @airo/components ChoiceList runs an internal reset effect
    // whose deps include `activeStep` and `collected`, both derived from the
    // `children` prop via useMemo. If the parent rebuilds the JSX children on
    // every render (the natural shape: `<ChoiceList>{questions.map(...)}</ChoiceList>`),
    // those internal memos invalidate every tick and the effect clears the
    // freeform "Other" draft to "". In production the parent re-renders every
    // few seconds (streaming/loading store ticks, store array re-emits), so
    // the user sees their in-progress text wiped out repeatedly.
    //
    // The fix memoizes the step-children array on the parent side. This test
    // forces a re-render with the SAME `result` reference and asserts the
    // typed text survives.
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }, { text: 'Blue' }]),
    ])
    const { rerender } = render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Purple' } })
    expect(input.value).toBe('Purple')

    rerender(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    // Same DOM input, same content. Without the parent-side memo on the
    // ChoiceList children, the rerender wipes the input back to "".
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Purple')
  })

  it('digit shortcut listener stays attached when hideQuestion=true (composer-card hoist path)', async () => {
    // Locks the contract that `hideQuestion` only suppresses the per-step
    // title text — it does NOT disable the keyboard listener. InputActionsPanel
    // always passes `hideQuestion={true}` when hoisting this component into
    // the composer card, and the digit shortcut must still move roving (so the
    // user can press Enter to commit). Treating `hideQuestion` as "renderer is
    // inert, drop the listener" was the bug that made digits silently no-op
    // for every real-world AskQuestion.
    //
    // We can't cleanly assert `data-visually-focused` here (jsdom doesn't run
    // @ux/listbox's roving logic the same way the browser does), so we check
    // the indirect signal that the listener fired: `focusChoiceListOptionByIndex`
    // focuses the listbox, which means after the digit press the active element
    // is the listbox (not the option that started focused).
    const result = makeResult([
      makeQuestion('Pick?', [{ text: 'Red' }, { text: 'Blue' }, { text: 'Green' }]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
        hideQuestion={true}
      />,
    )

    // Move focus inside the listbox so `shouldAllowChoiceListDigitShortcut`'s
    // "focus inside container ref" gate passes.
    const options = screen.getAllByRole('option')
    options[0].focus()

    fireEvent.keyDown(window, { key: '2' })

    // `focusChoiceListOptionByIndex` runs through setTimeout chains; wait one
    // task so the listbox.focus() inside it has executed.
    await new Promise((r) => setTimeout(r, 0))

    // Listener fired and routed to focusChoiceListOptionByIndex → listbox.focus().
    // If `hideQuestion` had killed the listener, focus would still be on options[0].
    expect(screen.getByRole('listbox', { name: 'Pick?' })).toHaveFocus()
  })
})
