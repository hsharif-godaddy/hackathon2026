/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AskQuestionChoicePanel from '@/app/[market]/develop/components/tool-renderers/AskQuestionChoicePanel'

describe('AskQuestionChoicePanel', () => {
  it('allowOther false without skipLabel does not render panel footer skip', () => {
    render(
      <AskQuestionChoicePanel
        questions={[
          {
            question: 'Is this what you imagined?',
            suggestions: [{ text: 'Looks great!' }],
            allowOther: false,
          },
        ]}
        allowOtherGlobal={false}
        rootOtherPlaceholder=""
        otherAriaLabel=""
        backLabel="Back"
        submitLabel="Submit"
        disabled={false}
        ariaLabel="Is this what you imagined?"
        onStepChange={vi.fn()}
        onActiveStepChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('ask-question-skip')).not.toBeInTheDocument()
  })

  it('stickyScrollLayout pins Other row footer and scrolls choice options', () => {
    render(
      <AskQuestionChoicePanel
        questions={[
          {
            question: 'Pick one',
            suggestions: [
              { text: 'One' },
              { text: 'Two' },
              { text: 'Three' },
              { text: 'Four' },
              { text: 'Five' },
            ],
            allowOther: true,
          },
        ]}
        allowOtherGlobal={true}
        rootOtherPlaceholder="Type your own"
        otherAriaLabel="Other"
        backLabel="Back"
        skipLabel="Skip"
        submitLabel="Submit"
        disabled={false}
        ariaLabel="Pick one"
        stickyScrollLayout
        onStepChange={vi.fn()}
        onActiveStepChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    const stickyRoot = screen.getByTestId('ask-question-sticky-scroll')
    const scrollArea = stickyRoot.querySelector('.overflow-y-auto')
    const pinnedFooter = stickyRoot.querySelector('.shrink-0.border-t')

    expect(scrollArea).toBeTruthy()
    expect(pinnedFooter).toBeTruthy()
    expect(scrollArea).toContainElement(screen.getByTestId('ask-question-choice-list'))
    expect(scrollArea).toContainElement(screen.getByText('One'))
    expect(scrollArea).not.toContainElement(screen.getByPlaceholderText('Type your own'))
    expect(scrollArea).not.toContainElement(screen.getByTestId('ask-question-skip'))

    expect(pinnedFooter).toContainElement(screen.getByPlaceholderText('Type your own'))
    expect(pinnedFooter).toContainElement(screen.getByTestId('ask-question-skip'))
    expect(pinnedFooter).not.toContainElement(screen.getByTestId('ask-question-choice-list'))
    expect(scrollArea?.parentElement).toBe(pinnedFooter?.parentElement)
  })

  it('stickyScrollLayout pins multi-select footerNav with submit and back', async function stickyMultiFooter() {
    const user = userEvent.setup()

    render(
      <AskQuestionChoicePanel
        questions={[
          {
            question: 'Step one',
            type: 'chips_multi',
            suggestions: [{ text: 'Option A' }, { text: 'Option B' }],
            allowOther: false,
          },
          {
            question: 'Step two',
            type: 'chips_multi',
            suggestions: [{ text: 'Option C' }, { text: 'Option D' }],
            allowOther: false,
          },
        ]}
        allowOtherGlobal={false}
        rootOtherPlaceholder=""
        otherAriaLabel=""
        backLabel="Back"
        skipLabel="Skip"
        submitLabel="Submit"
        disabled={false}
        ariaLabel="Step one"
        stickyScrollLayout
        onStepChange={vi.fn()}
        onActiveStepChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    const stickyRoot = screen.getByTestId('ask-question-sticky-scroll')
    expect(stickyRoot).toBeInTheDocument()
    expect(screen.getByTestId('ask-question-submit')).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Option A/i }))
    await user.click(screen.getByTestId('ask-question-submit'))

    expect(screen.getByText('Step two')).toBeInTheDocument()
    expect(screen.getByTestId('ask-question-back')).toBeInTheDocument()
    expect(screen.getByTestId('ask-question-submit')).toBeInTheDocument()

    const scrollArea = stickyRoot.querySelector('.overflow-y-auto')
    expect(scrollArea).toBeTruthy()
    expect(scrollArea).toContainElement(screen.getByTestId('ask-question-choice-list'))
    expect(scrollArea).not.toContainElement(screen.getByTestId('ask-question-submit'))
    expect(scrollArea).not.toContainElement(screen.getByTestId('ask-question-back'))

    const pinnedFooter = screen.getByTestId('ask-question-submit').closest('.border-t')
    expect(pinnedFooter).toBeTruthy()
    expect(stickyRoot).toContainElement(pinnedFooter)
  })
})
