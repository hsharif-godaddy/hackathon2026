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

  it('allowOther: false hides the OptionInput', () => {
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

  it('allowOther: true (default) shows OptionInput and typing + submitting sends as answer', () => {
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

    // Click the submit button (aria-label from translation key)
    const submitButton = screen.getByLabelText('builder_common_submit')
    fireEvent.click(submitButton)

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
})
