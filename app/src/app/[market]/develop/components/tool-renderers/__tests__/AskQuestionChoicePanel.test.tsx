/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
})
