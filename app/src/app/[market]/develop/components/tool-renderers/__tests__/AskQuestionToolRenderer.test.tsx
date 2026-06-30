/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AskQuestionToolRenderer from '../AskQuestionToolRenderer'

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
const { mockLogAiroHQEvent } = vi.hoisted(() => ({
  mockLogAiroHQEvent: vi.fn(function () { return () => {}; }),
}))
vi.mock('@/utils/instrumentation', () => ({
  logAiroHQEvent: mockLogAiroHQEvent,
}))

const { mockIsInitialBuildFunnelActive, mockIsInitialBuildComplete } = vi.hoisted(() => ({
  mockIsInitialBuildFunnelActive: vi.fn(function () { return false; }),
  mockIsInitialBuildComplete: vi.fn(function () { return true; }),
}))
vi.mock('@/hooks/shared/initialBuildFunnel', () => ({
  isInitialBuildFunnelActive: () => mockIsInitialBuildFunnelActive(),
  isInitialBuildComplete: () => mockIsInitialBuildComplete(),
}))

const {
  mockTrackFlowStarted,
  mockTrackQuestionShown,
  mockTrackQuestionAnswered,
  mockTrackQuestionSkipped,
  mockTrackNavigatorClicked,
  mockTrackFlowCompleted,
} = vi.hoisted(() => ({
  mockTrackFlowStarted: vi.fn(),
  mockTrackQuestionShown: vi.fn(),
  mockTrackQuestionAnswered: vi.fn(),
  mockTrackQuestionSkipped: vi.fn(),
  mockTrackNavigatorClicked: vi.fn(),
  mockTrackFlowCompleted: vi.fn(),
}))
vi.mock('@/lib/askQuestionAnalytics', () => ({
  trackFlowStarted: (...a: unknown[]) => mockTrackFlowStarted(...a),
  trackQuestionShown: (...a: unknown[]) => mockTrackQuestionShown(...a),
  trackQuestionAnswered: (...a: unknown[]) => mockTrackQuestionAnswered(...a),
  trackQuestionSkipped: (...a: unknown[]) => mockTrackQuestionSkipped(...a),
  trackNavigatorClicked: (...a: unknown[]) => mockTrackNavigatorClicked(...a),
  trackFlowCompleted: (...a: unknown[]) => mockTrackFlowCompleted(...a),
  generateFlowId: () => 'test-flow-id',
}))
vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: () => ({ cohort: 'initial_agent_v3', data: undefined, experiment: undefined }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock('@ux/box', () => ({
  default: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

vi.mock('@ux/text', () => ({
  default: {
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
}))

vi.mock('@ux/icon/arrow-right', () => ({
  default: (props: any) => <span data-testid="arrow-right-icon" {...props} />,
}))

vi.mock('@ux/icon/arrow-left', () => ({
  default: (props: any) => <span data-testid="arrow-left-icon" {...props} />,
}))

vi.mock('@ux/icon/checkmark', () => ({
  default: (props: any) => <span data-testid="checkmark-icon" {...props} />,
}))

vi.mock('@ux/tag', () => ({
  default: ({ children, ...props }: any) => <span data-testid="step-progress-tag" {...props}>{children}</span>,
}))

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon, ...rest }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} {...rest} />
  ),
}))

vi.mock('@ux/listbox', () => ({
  default: ({
    items,
    onConfirm,
    onActiveItemChange,
    selected,
    ref: listboxRef,
    ...rest
  }: any) => (
    <div
      role="listbox"
      ref={listboxRef}
      {...rest}
    >
      {items?.map((item: any) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={selected === item.id ? 'true' : 'false'}
          onClick={() => onConfirm?.(item.id, { event: null })}
          onFocus={() => onActiveItemChange?.(item.id)}
        >
          {item.children}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@ux/text-entry', () => ({
  default: ({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    'aria-label': ariaLabel,
    ...rest
  }: any) => (
    <input
      role="textbox"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      {...rest}
    />
  ),
}))

vi.mock('@ux/checkbox', () => ({
  default: ({
    label,
    checked,
    onChange,
    id,
    name,
    disabled,
    'aria-label': ariaLabel,
    tabIndex,
  }: any) => (
    <label htmlFor={id}>
      <input
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {typeof label === 'string' ? label : <span>{label}</span>}
    </label>
  ),
}))

function clickChipOption(label: string | RegExp) {
  fireEvent.click(screen.getByRole('option', { name: label }))
}

function selectedChipOption(label: string | RegExp) {
  return screen.getByRole('option', { name: label })
}

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

function submitSelection() {
  fireEvent.click(screen.getByTestId('ask-question-submit'))
}

function skipSelection() {
  fireEvent.click(screen.getByTestId('ask-question-skip'))
}

describe('AskQuestionToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsInitialBuildFunnelActive.mockReturnValue(false)
    mockIsInitialBuildComplete.mockReturnValue(true)
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

  it('single question: selecting a suggestion sends the answer immediately', () => {
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
    expect(screen.getByRole('option', { name: /Red/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Blue/ })).toBeInTheDocument()

    clickChipOption(/Red/)

    expect(mockSendUserMessage).toHaveBeenCalledWith('Red', { isActionRequest: true })
  })

  it('multi-question: selecting suggestions advances then sends formatted message', () => {
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

    expect(screen.getByText('What color?')).toBeInTheDocument()

    clickChipOption(/Red/)

    expect(mockSendUserMessage).not.toHaveBeenCalled()
    expect(screen.getByText('What size?')).toBeInTheDocument()

    clickChipOption(/Large/)

    expect(mockSendUserMessage).toHaveBeenCalledWith(
      '1) What color?\nRed\n\n2) What size?\nLarge',
      { isActionRequest: true },
    )
  })

  it('does not show back button on the first question', () => {
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

    expect(screen.queryByTestId('ask-question-back')).not.toBeInTheDocument()
  })

  it('shows inline back button from the second question onward', () => {
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

    clickChipOption(/Red/)

    expect(screen.getByTestId('ask-question-back')).toBeInTheDocument()
    expect(screen.getByTestId('ask-question-back')).toHaveAttribute('aria-label', 'builder_common_back')
  })

  it('inline back button returns to the previous question', () => {
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

    clickChipOption(/Blue/)
    expect(screen.getByText('What size?')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ask-question-back'))

    expect(screen.getByText('What color?')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-question-back')).not.toBeInTheDocument()
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

  it('allowOther: false renders skip in footer and skipping dismisses without sending', () => {
    const onSkip = vi.fn()
    const result = makeResult([
      makeQuestion('What color?', [{ text: 'Red' }, { text: 'Blue' }], false),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
        onSkip={onSkip}
      />,
    )

    expect(screen.getByTestId('ask-question-skip')).toBeInTheDocument()
    skipSelection()

    expect(mockSendUserMessage).not.toHaveBeenCalled()
    expect(onSkip).toHaveBeenCalledTimes(1)
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

    clickChipOption(/Red/)

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

    clickChipOption(/Red/)

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

    clickChipOption(/Blue/)

    expect(mockSendUserMessage).toHaveBeenCalledWith('color_blue', { isActionRequest: true })
  })

  it('suggestion with trackingId emits it as recommendation_id; untagged falls back to positional id', () => {
    const result = makeResult([{
      question: 'What next?',
      suggestions: [
        { text: 'Edit logo' },
        { text: 'Build website', trackingId: 'logo_designer_build_website' },
      ],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    clickChipOption(/Build website/)

    expect(mockLogAiroHQEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'click',
        recommendation_task: 'builder_askquestion_suggestion_click',
        recommendation_id: 'logo_designer_build_website',
      }),
    )

    mockLogAiroHQEvent.mockClear()

    const result2 = makeResult([{
      question: 'What next?',
      suggestions: [
        { text: 'Edit logo' },
        { text: 'Build website', trackingId: 'logo_designer_build_website' },
      ],
    }])
    const { unmount } = render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result2}
      />,
    )
    clickChipOption(/Edit logo/)

    expect(mockLogAiroHQEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendation_task: 'builder_askquestion_suggestion_click',
        recommendation_id: 'q0_s0',
      }),
    )
    unmount()
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
    expect(screen.queryAllByRole('option').length).toBe(0)
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

  it("type 'text' with a decide chip renders both the input and the chip", () => {
    // Text questions get a freeform input AND the "Decide for me" chip so the
    // user can defer without typing. The chip resolves to canonical English in
    // the message just like on chip-only questions.
    const result = makeResult([{
      question: 'Where is the shop located?',
      type: 'text',
      placeholder: 'e.g. Phoenix',
      suggestions: [{ text: 'Decide for me', value: '__decide__' }],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getByPlaceholderText('e.g. Phoenix')).toBeInTheDocument()
    const decide = screen.getByRole('option', {
      name: /builder_tools_askquestion_decide_for_me/,
    })
    fireEvent.click(decide)
    expect(mockSendUserMessage).toHaveBeenCalledWith('Decide for me', { isActionRequest: true })
  })

  it("type 'text' business name lists escape chip first, name field second, without a type-in chip", () => {
    const result = makeResult([{
      question: "What's your business name?",
      type: 'text',
      placeholder: 'e.g. Bloom Boutique, Peak Gear Co.',
      suggestions: [
        { text: "I don't have one yet" },
        { text: "I'll type it in" },
      ],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: /I don't have one yet/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /I'll type it in/i })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Bloom Boutique, Peak Gear Co.')).toBeInTheDocument()
  })

  it('business name escape chip submits immediately', async () => {
    const user = userEvent.setup()
    const result = makeResult([{
      question: "What's your business name?",
      type: 'text',
      placeholder: 'e.g. Bloom Boutique, Peak Gear Co.',
      suggestions: [
        { text: "I don't have one yet" },
      ],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    await user.click(screen.getByRole('option', { name: /I don't have one yet/i }))

    expect(mockSendUserMessage).toHaveBeenCalledWith("I don't have one yet", { isActionRequest: true })
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

  it('decide chip renders the i18n label, not the raw English text from the agent', () => {
    const result = makeResult([
      {
        question: 'Vibe?',
        type: 'chips_single',
        suggestions: [
          { text: 'Cozy' },
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

    expect(
      screen.getByRole('option', { name: /builder_tools_askquestion_decide_for_me/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Decide for me$/ })).not.toBeInTheDocument()
  })

  it('clicking the decide chip emits canonical "Decide for me" in the message', () => {
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

    const decideOptions = screen.getAllByRole('option', {
      name: /builder_tools_askquestion_decide_for_me/,
    })
    expect(decideOptions).toHaveLength(1)
    fireEvent.click(decideOptions[0])
    const decideOnNextStep = screen.getByRole('option', {
      name: /builder_tools_askquestion_decide_for_me/,
    })
    fireEvent.click(decideOnNextStep)

    expect(mockSendUserMessage).toHaveBeenCalledTimes(1)
    const [msg] = mockSendUserMessage.mock.calls[0]
    expect(msg).not.toMatch(/__decide__/)
    expect(msg.match(/Decide for me/g)?.length).toBe(2)
  })

  it('skipping every step dismisses without sending a chat message', () => {
    const onComplete = vi.fn()
    const onSkip = vi.fn()
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
        onComplete={onComplete}
        onSkip={onSkip}
      />,
    )

    skipSelection()
    skipSelection()

    expect(mockSendUserMessage).not.toHaveBeenCalled()
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('skipping a single-step askQuestion dismisses without sending a chat message', () => {
    const onSkip = vi.fn()
    const result = makeResult([
      makeQuestion('Do you like the design?', [
        { text: 'Yes, build the next page' },
        { text: 'Change the color scheme' },
      ]),
    ])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
        onSkip={onSkip}
      />,
    )

    skipSelection()

    expect(mockSendUserMessage).not.toHaveBeenCalled()
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('digit press on focused Other input does not trigger a pick', async () => {
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

    expect(otherInput).toHaveFocus()
    expect(mockSendUserMessage).not.toHaveBeenCalled()
    expect(selectedChipOption(/Red/)).not.toHaveAttribute('aria-selected', 'true')
  })

  it('Other input keeps typed text across parent re-renders with the same result', () => {
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

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Purple')
  })

  it('digit shortcut selects the matching option when hideQuestion=true (composer-card hoist path)', async () => {
    mockIsInitialBuildFunnelActive.mockReturnValue(true)
    mockIsInitialBuildComplete.mockReturnValue(false)

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

    const options = screen.getAllByRole('option')
    options[0].focus()

    fireEvent.keyDown(window, { key: '2' })
    await new Promise((r) => setTimeout(r, 0))

    expect(mockSendUserMessage).toHaveBeenCalledWith('Blue', { isActionRequest: true })
  })

  it('multi-select renders ChoiceList checkbox rows', () => {
    const result = makeResult([{
      question: 'What goals?',
      type: 'chips_multi',
      suggestions: [
        { text: 'Show menus' },
        { text: 'Share location' },
        { text: 'Take reservations' },
      ],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /Show menus|Share location|Take reservations|Enable custom text/i })).toHaveLength(4)
    expect(screen.getByTestId('ask-question-submit')).toBeDisabled()
  })

  it('multi-select toggles checkboxes and submits combined answers', () => {
    const result = makeResult([{
      question: 'What goals?',
      type: 'chips_multi',
      suggestions: [
        { text: 'Show menus' },
        { text: 'Share location' },
        { text: 'Take reservations' },
      ],
    }])
    render(
      <AskQuestionToolRenderer
        {...defaultProps}
        result={result}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /Show menus/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Take reservations/i }))
    expect(screen.getByRole('checkbox', { name: /Show menus/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Take reservations/i })).toBeChecked()

    submitSelection()
    expect(mockSendUserMessage).toHaveBeenCalledWith('Show menus, Take reservations', { isActionRequest: true })
  })

  describe('analytics events', () => {
    beforeEach(() => {
      mockTrackFlowStarted.mockReset()
      mockTrackQuestionShown.mockReset()
      mockTrackQuestionAnswered.mockReset()
      mockTrackQuestionSkipped.mockReset()
      mockTrackNavigatorClicked.mockReset()
      mockTrackFlowCompleted.mockReset()
      mockIsInitialBuildFunnelActive.mockReturnValue(true)
      mockIsInitialBuildComplete.mockReturnValue(false)
    })

    it('fires flow_started once with total_questions, app_creation and endgame_cohort', () => {
      const result = makeResult([
        makeQuestion('Q1?', [{ text: 'A' }, { text: 'B' }]),
        makeQuestion('Q2?', [{ text: 'C' }, { text: 'D' }]),
      ])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)

      expect(mockTrackFlowStarted).toHaveBeenCalledTimes(1)
      expect(mockTrackFlowStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: expect.any(String),
          appCreation: true,
          endgameCohort: 'initial_agent_v3',
        }),
        2,
      )
    })

    it('does not fire flow_started when this is not the last assistant message', () => {
      const result = makeResult([makeQuestion('Q1?', [{ text: 'A' }, { text: 'B' }])])
      render(
        <AskQuestionToolRenderer {...defaultProps} result={result} isLastAssistantMessage={false} />,
      )
      expect(mockTrackFlowStarted).not.toHaveBeenCalled()
    })

    it('fires question_shown with 1-based position on initial render', () => {
      const result = makeResult([makeQuestion('Q1?', [{ text: 'A' }, { text: 'B' }])])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      expect(mockTrackQuestionShown).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        1,
      )
    })

    it('fires question_answered with position when a suggestion is selected', () => {
      const result = makeResult([makeQuestion('Q1?', [{ text: 'Red' }, { text: 'Blue' }])])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      clickChipOption(/Red/)
      expect(mockTrackQuestionAnswered).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        1,
      )
      expect(mockTrackNavigatorClicked).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        1,
        'forward',
      )
      expect(mockTrackQuestionSkipped).not.toHaveBeenCalled()
    })

    it('fires question_skipped with position when Skip is clicked', () => {
      const result = makeResult([
        makeQuestion('Q1?', [{ text: 'Red' }, { text: 'Blue' }]),
        makeQuestion('Q2?', [{ text: 'C' }, { text: 'D' }]),
      ])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      fireEvent.click(screen.getByTestId('ask-question-skip'))
      expect(mockTrackQuestionSkipped).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        1,
      )
      expect(mockTrackNavigatorClicked).not.toHaveBeenCalled()
    })

    it('fires navigator_clicked back when Back is clicked on question 2', () => {
      const result = makeResult([
        makeQuestion('Q1?', [{ text: 'A' }, { text: 'B' }]),
        makeQuestion('Q2?', [{ text: 'C' }, { text: 'D' }]),
      ])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      clickChipOption(/A/) // answer Q1 -> advances to Q2 (position 2)
      fireEvent.click(screen.getByTestId('ask-question-back'))
      expect(mockTrackNavigatorClicked).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        2,
        'back',
      )
    })

    it('fires navigator_clicked forward when the forward chevron advances a multi-select question', () => {
      const result = makeResult([
        {
          question: 'What goals?',
          type: 'chips_multi',
          suggestions: [{ text: 'Show menus' }, { text: 'Share location' }],
        },
        makeQuestion('Q2?', [{ text: 'C' }, { text: 'D' }]),
      ])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      fireEvent.click(screen.getByRole('checkbox', { name: /Show menus/i })) // enable submit on Q1 (position 1)
      fireEvent.click(screen.getByTestId('ask-question-submit'))
      expect(mockTrackNavigatorClicked).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        1,
        'forward',
      )
    })

    it('fires navigator_clicked forward when a text-step answer is submitted', () => {
      const result = makeResult([
        {
          question: 'Your brand name?',
          type: 'text' as const,
          placeholder: 'Your answer...',
          suggestions: [],
        },
        makeQuestion('Q2?', [{ text: 'C' }, { text: 'D' }]),
      ])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      const input = screen.getByPlaceholderText('Your answer...')
      fireEvent.change(input, { target: { value: 'Sweet Rise' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(mockTrackNavigatorClicked).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String) }),
        1,
        'forward',
      )
    })

    it('fires flow_completed once when the single-question flow advances', () => {
      const result = makeResult([makeQuestion('Q1?', [{ text: 'Red' }, { text: 'Blue' }])])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      clickChipOption(/Red/) // single question commits -> completes
      expect(mockTrackFlowCompleted).toHaveBeenCalledTimes(1)
      expect(mockTrackFlowCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: expect.any(String), appCreation: true }),
      )
    })

    it('stamps app_creation=false and omits endgameCohort when not in the initial-build funnel', () => {
      mockIsInitialBuildFunnelActive.mockReturnValue(false)
      mockIsInitialBuildComplete.mockReturnValue(true)
      const result = makeResult([makeQuestion('Q1?', [{ text: 'A' }, { text: 'B' }])])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      expect(mockTrackFlowStarted).toHaveBeenCalledWith(
        expect.objectContaining({ appCreation: false, endgameCohort: undefined }),
        1,
      )
    })

    it('fires flow_started before the first question_shown', () => {
      const result = makeResult([makeQuestion('Q1?', [{ text: 'A' }, { text: 'B' }])])
      render(<AskQuestionToolRenderer {...defaultProps} result={result} />)
      expect(mockTrackFlowStarted).toHaveBeenCalledTimes(1)
      expect(mockTrackQuestionShown).toHaveBeenCalled()
      const startedOrder = mockTrackFlowStarted.mock.invocationCallOrder[0]
      const shownOrder = mockTrackQuestionShown.mock.invocationCallOrder[0]
      expect(startedOrder).toBeLessThan(shownOrder)
    })
  })

  describe('follow-up single select', function followUpSingleSelect() {
    function renderFollowUpQuestion(questions: ReturnType<typeof makeQuestion>[]) {
      render(
        <AskQuestionToolRenderer
          {...defaultProps}
          result={makeResult(questions)}
          hideQuestion={true}
        />,
      )
    }

    it('autoSubmitsOnSelect when Other is disabled', function autoSubmit() {
      renderFollowUpQuestion([
        makeQuestion('Do you like the design?', [{ text: 'Yes' }, { text: 'No' }], false),
      ])

      expect(screen.queryByTestId('ask-question-submit')).not.toBeInTheDocument()

      clickChipOption(/Yes/)

      expect(mockSendUserMessage).toHaveBeenCalledWith('Yes', { isActionRequest: true })
    })

    it('autoSubmitsOnSelect when Other is enabled', function autoSubmitWithOther() {
      renderFollowUpQuestion([
        makeQuestion('Do you like the design?', [{ text: 'Yes' }, { text: 'No' }], true),
      ])

      clickChipOption(/Yes/)

      expect(mockSendUserMessage).toHaveBeenCalledWith('Yes', { isActionRequest: true })
    })

    it('autoSubmitsOnSelect during initial build in composer card', function initialBuildComposer() {
      mockIsInitialBuildFunnelActive.mockReturnValue(true)
      mockIsInitialBuildComplete.mockReturnValue(false)

      renderFollowUpQuestion([
        makeQuestion('Pick a vibe?', [{ text: 'Modern' }, { text: 'Classic' }], false),
      ])

      clickChipOption(/Modern/)

      expect(mockSendUserMessage).toHaveBeenCalledWith('Modern', { isActionRequest: true })
    })
  })
})
