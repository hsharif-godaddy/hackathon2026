/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import SuggestedResponseToolRenderer from '../SuggestedResponseToolRenderer'

const mockSendUserMessage = vi.fn()
vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => mockSendUserMessage,
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}))

const defaultProps = {
  toolName: 'suggestedResponse',
  toolStatus: 'completed' as const,
  input: {},
  error: undefined,
  isLastAssistantMessage: true,
}

describe('SuggestedResponseToolRenderer', function suggestedResponseTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  it('returns null when suggestions is not an array', function malformedSuggestions() {
    const { container } = render(
      <SuggestedResponseToolRenderer
        {...defaultProps}
        result={{
          output: {
            widgetData: {
              question: 'Pick one',
              suggestions: {},
            },
          },
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders options when widgetData is valid', function validPayload() {
    render(
      <SuggestedResponseToolRenderer
        {...defaultProps}
        result={{
          output: {
            widgetData: {
              question: 'Pick one',
              suggestions: [{ text: 'Yes' }, { text: 'No' }],
            },
          },
        }}
      />,
    )

    expect(screen.getByText('Pick one')).toBeInTheDocument()
    expect(screen.getAllByTestId('choice-option-row')).toHaveLength(2)
  })
})
