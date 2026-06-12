/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent,render, screen } from '@testing-library/react'

const mockSendUserMessage = vi.fn()
vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => mockSendUserMessage,
}))

const mockTrackCloseSelection = vi.fn()
const mockTrackOffbaseAction = vi.fn()

vi.mock('@/lib/firstBuildFeedbackAnalytics', () => ({
  trackFeedbackShown: vi.fn(),
  trackFeedbackResponse: vi.fn(),
  trackFollowupResponse: vi.fn(),
  trackCloseSelection: (...args: unknown[]) => mockTrackCloseSelection(...args),
  trackOffbaseAction: (...args: unknown[]) => mockTrackOffbaseAction(...args),
  CLOSE_CHIP_MAP: { 0: 'color_scheme', 1: 'fonts', 2: 'tone' },
}))

vi.mock('@airo-ux/pattern-library/input/choice-list', () => ({
  ChoiceListOtherRow: ({
    otherPlaceholder,
    onSubmit,
    draft,
    onDraftChange,
  }: {
    otherPlaceholder: string
    onSubmit: (v: string) => void
    draft: string
    onDraftChange: (v: string) => void
    [key: string]: unknown
  }) => (
    <div>
      <input
        placeholder={otherPlaceholder}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
      />
      <button aria-label="Submit" onClick={() => onSubmit(draft.trim())}>Submit</button>
    </div>
  ),
}))

function MockAskQuestionChoicePanel({
  questions,
  rootOtherPlaceholder,
  skipLabel,
  onComplete,
}: {
  questions: Array<{ suggestions: Array<{ text: string }>; allowOther?: boolean }>
  rootOtherPlaceholder: string
  skipLabel?: string
  onComplete: (selections: Record<string, string | null>) => void
  [key: string]: unknown
}) {
  const [otherDraft, setOtherDraft] = React.useState('')
  const suggestions = questions[0]?.suggestions ?? []
  // Distinguish prompt panel (no rootOtherPlaceholder) from close_followup (has placeholder)
  const isPromptPanel = !rootOtherPlaceholder
  return (
    <div>
      {suggestions.map((s, i) => (
        <button
          key={i}
          data-testid={isPromptPanel ? `aqcp-option-${i}` : `choice-item-${i}`}
          onClick={() => onComplete({ '0': String(i + 1) })}
        >
          {s.text}
        </button>
      ))}
      {!isPromptPanel && (
        <>
          <input
            placeholder={rootOtherPlaceholder}
            value={otherDraft}
            onChange={(e) => setOtherDraft(e.target.value)}
          />
          <button
            aria-label="Submit"
            onClick={() => onComplete({ '0': otherDraft.trim() })}
          >
            Submit
          </button>
          {skipLabel != null && (
            <button
              data-testid="aqcp-inline-skip"
              onClick={() => onComplete({ '0': null })}
            >
              {skipLabel}
            </button>
          )}
        </>
      )}
    </div>
  )
}

vi.mock(
  '@/app/[market]/develop/components/tool-renderers/AskQuestionChoicePanel',
  () => ({
    default: MockAskQuestionChoicePanel,
  }),
)

// Mock CollapsibleChatInputSection — render children + title + onDismiss as Skip button + footer
vi.mock(
  '@/app/[market]/develop/components/chat/CollapsibleChatInputSection',
  () => ({
    default: ({
      title,
      children,
      onDismiss,
      dismissLabel,
      footer,
    }: {
      title: string
      children: React.ReactNode
      onDismiss?: () => void
      dismissLabel?: string
      footer?: React.ReactNode
    }) => (
      <div>
        <span data-testid="section-title">{title}</span>
        {children}
        {footer}
        {onDismiss && (
          <button data-testid="section-dismiss" onClick={onDismiss}>
            {dismissLabel ?? 'Close'}
          </button>
        )}
      </div>
    ),
  }),
)

import { FirstBuildFeedbackPanel } from './FirstBuildFeedbackPanel'
import type { UseFirstBuildFeedbackResult } from './useFirstBuildFeedback'

function makeFeedback(overrides: Partial<UseFirstBuildFeedbackResult> = {}): UseFirstBuildFeedbackResult {
  return {
    step: 'prompt',
    advance: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  }
}

describe('FirstBuildFeedbackPanel — prompt step', () => {
  beforeEach(() => {
    mockSendUserMessage.mockReset()
  })

  it('renders title and three chip options plus skip', () => {
    render(<FirstBuildFeedbackPanel feedback={makeFeedback()} appId="app1" />)
    expect(screen.getByTestId('section-title')).toHaveTextContent('Is this what you imagined?')
    expect(screen.getByTestId('aqcp-option-0')).toHaveTextContent('Looks great!')
    expect(screen.getByTestId('aqcp-option-1')).toHaveTextContent('Close, needs some work')
    expect(screen.getByTestId('aqcp-option-2')).toHaveTextContent('Not what I expected')
    const skipButtons = screen.getAllByRole('button', { name: 'Skip' })
    expect(skipButtons.length).toBeGreaterThan(0)
  })

  it('Magical (chip 0) calls dismiss magical, not sendUserMessage', () => {
    const dismiss = vi.fn()
    render(<FirstBuildFeedbackPanel feedback={makeFeedback({ dismiss })} appId="app1" />)
    fireEvent.click(screen.getByTestId('aqcp-option-0'))
    expect(dismiss).toHaveBeenCalledWith('magical')
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })

  it('Close (chip 1) calls advance to close_followup', () => {
    const advance = vi.fn()
    render(<FirstBuildFeedbackPanel feedback={makeFeedback({ advance })} appId="app1" />)
    fireEvent.click(screen.getByTestId('aqcp-option-1'))
    expect(advance).toHaveBeenCalledWith('close_followup')
  })

  it('Offbase (chip 2) calls advance to offbase_followup', () => {
    const advance = vi.fn()
    render(<FirstBuildFeedbackPanel feedback={makeFeedback({ advance })} appId="app1" />)
    fireEvent.click(screen.getByTestId('aqcp-option-2'))
    expect(advance).toHaveBeenCalledWith('offbase_followup')
  })

  it('Skip button inside panel calls dismiss skipped', () => {
    const dismiss = vi.fn()
    render(<FirstBuildFeedbackPanel feedback={makeFeedback({ dismiss })} appId="app1" />)
    const skipButtons = screen.getAllByRole('button', { name: 'Skip' })
    // Click the footer Skip button (the last one rendered)
    fireEvent.click(skipButtons[skipButtons.length - 1]!)
    expect(dismiss).toHaveBeenCalledWith('skipped')
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })

  it('Skip (dismiss button) calls dismiss skipped', () => {
    const dismiss = vi.fn()
    render(<FirstBuildFeedbackPanel feedback={makeFeedback({ dismiss })} appId="app1" />)
    fireEvent.click(screen.getByTestId('section-dismiss'))
    expect(dismiss).toHaveBeenCalledWith('skipped')
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })
})

describe('FirstBuildFeedbackPanel — close_followup step', () => {
  beforeEach(() => {
    mockSendUserMessage.mockReset()
    mockTrackCloseSelection.mockReset()
  })

  it('renders chip options and free-text placeholder', () => {
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup' })}
        appId="app1"
      />
    )
    expect(screen.getByTestId('choice-item-0')).toHaveTextContent('Change the color scheme')
    expect(screen.getByTestId('choice-item-1')).toHaveTextContent('Change the fonts')
    expect(screen.getByTestId('choice-item-2')).toHaveTextContent('Change the tone')
    expect(screen.getByPlaceholderText('Tell us what to tweak...')).toBeInTheDocument()
  })

  it('chip selection (index 0) sends message and dismisses close', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup', dismiss })}
        appId="app1"
      />
    )
    fireEvent.click(screen.getByTestId('choice-item-0'))
    expect(mockSendUserMessage).toHaveBeenCalledWith('Change the color scheme', { isActionRequest: true })
    expect(dismiss).toHaveBeenCalledWith('close')
  })

  it('free-text submission sends message and dismisses close', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup', dismiss })}
        appId="app1"
      />
    )
    const input = screen.getByPlaceholderText('Tell us what to tweak...')
    fireEvent.change(input, { target: { value: 'Change the layout' } })
    fireEvent.click(screen.getByLabelText('Submit'))
    expect(mockSendUserMessage).toHaveBeenCalledWith('Change the layout', { isActionRequest: true })
    expect(dismiss).toHaveBeenCalledWith('close')
  })

  it('free-text starting with a digit is sent verbatim, not replaced with chip label', () => {
    // Covers the numeric-leading collision: "2 column layout" must not become "Change the fonts"
    // parseInt('2 column layout', 10) === 2, so without the /^\d+$/ guard it would resolve
    // to chipIndex 1 and send CLOSE_OPTIONS[1] = 'Change the fonts' instead.
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup', dismiss })}
        appId="app1"
      />
    )
    const input = screen.getByPlaceholderText('Tell us what to tweak...')
    fireEvent.change(input, { target: { value: '2 column layout' } })
    fireEvent.click(screen.getByLabelText('Submit'))
    expect(mockSendUserMessage).toHaveBeenCalledWith('2 column layout', { isActionRequest: true })
    expect(dismiss).toHaveBeenCalledWith('close')
  })

  it('skip on close_followup calls dismiss skipped', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup', dismiss })}
        appId="app1"
      />
    )
    fireEvent.click(screen.getByTestId('section-dismiss'))
    expect(dismiss).toHaveBeenCalledWith('skipped')
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })

  it('inline skip (null from AskQuestionChoicePanel) calls trackCloseSelection skipped and dismiss skipped', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup', dismiss })}
        appId="app1"
      />
    )
    fireEvent.click(screen.getByTestId('aqcp-inline-skip'))
    expect(dismiss).toHaveBeenCalledWith('skipped')
    expect(mockTrackCloseSelection).toHaveBeenCalledWith('skipped', 'app1')
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })

  it('chip selection (index 0) calls trackCloseSelection color_scheme', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'close_followup', dismiss })}
        appId="app1"
      />
    )
    fireEvent.click(screen.getByTestId('choice-item-0'))
    expect(mockTrackCloseSelection).toHaveBeenCalledWith('color_scheme', 'app1')
    expect(mockSendUserMessage).toHaveBeenCalledWith('Change the color scheme', { isActionRequest: true })
    expect(dismiss).toHaveBeenCalledWith('close')
  })
})

describe('FirstBuildFeedbackPanel — offbase_followup step', () => {
  beforeEach(() => {
    mockSendUserMessage.mockReset()
    mockTrackOffbaseAction.mockReset()
  })

  it('renders text-only input, no chips', () => {
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'offbase_followup' })}
        appId="app1"
      />
    )
    expect(screen.getByPlaceholderText('Describe what you had in mind...')).toBeInTheDocument()
    expect(screen.queryByTestId('aqcp-option-0')).not.toBeInTheDocument()
  })

  it('submit sends message and calls dismiss offbase', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'offbase_followup', dismiss })}
        appId="app1"
      />
    )
    const input = screen.getByPlaceholderText('Describe what you had in mind...')
    fireEvent.change(input, { target: { value: 'A photography portfolio' } })
    fireEvent.click(screen.getByLabelText('Submit'))
    expect(mockSendUserMessage).toHaveBeenCalledWith('A photography portfolio', { isActionRequest: true })
    expect(dismiss).toHaveBeenCalledWith('offbase')
  })

  it('skip calls dismiss skipped, no sendUserMessage', () => {
    const dismiss = vi.fn()
    render(
      <FirstBuildFeedbackPanel
        feedback={makeFeedback({ step: 'offbase_followup', dismiss })}
        appId="app1"
      />
    )
    fireEvent.click(screen.getByTestId('section-dismiss'))
    expect(dismiss).toHaveBeenCalledWith('skipped')
    expect(mockSendUserMessage).not.toHaveBeenCalled()
  })
})
