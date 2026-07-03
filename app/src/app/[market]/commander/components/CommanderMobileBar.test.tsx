/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { forwardRef, type ReactNode, type Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { CanvasId, PINNED_CANVAS_ID } from '@/app/[market]/commander/canvas/registry'
import type { LatestNBAData } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { renderWithProviders } from '@/tests/test-utils'
import { CommanderMobileBar } from './CommanderMobileBar'

let latestNBA: LatestNBAData | null = null
let initialBuildActive = false
let initialBuildComplete = false
let activeRunningToolName: string | null = null
let isLoading = false

vi.mock('@ux/button', () => ({
  default: forwardRef(function MockButton(
    {
      icon,
      text,
      onClick,
      ...rest
    }: {
      icon?: ReactNode
      text?: ReactNode
      onClick?: () => void
      [key: string]: unknown
    },
    ref: Ref<HTMLButtonElement>,
  ) {
    return (
      <button ref={ref} type="button" onClick={onClick} {...rest}>
        {icon}
        {text}
      </button>
    )
  }),
}))

vi.mock('@ux/icon/conversations', () => ({
  default: function ConversationsIcon(): ReactNode {
    return <svg data-testid="conversations-icon" />
  },
}))

vi.mock('@/app/[market]/develop/components/chat/useLatestNBAs', () => ({
  useLatestNBAs: () => latestNBA,
}))

vi.mock('@/hooks/shared/initialBuildFunnel', () => ({
  isInitialBuildComplete: () => initialBuildComplete,
  isInitialBuildFunnelActive: () => initialBuildActive,
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => false,
}))

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: () => () => {},
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useActiveRunningToolName: () => activeRunningToolName,
  useIsLoading: () => isLoading,
}))

vi.mock('../canvas/CommanderCanvasSheet', () => ({
  CommanderCanvasSheet: () => null,
}))

function renderBar(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<CommanderMobileBar />)
}

describe('CommanderMobileBar', () => {
  beforeEach(function reset(): void {
    latestNBA = null
    initialBuildActive = false
    initialBuildComplete = false
    activeRunningToolName = null
    isLoading = false
    useCommanderStore.setState({
      activeCanvasId: PINNED_CANVAS_ID,
      openCanvasIds: [CanvasId.Preview],
    })
  })

  it('shows a badge on the chat button when an askQuestion NBA is pending', function askQuestionBadge(): void {
    initialBuildActive = true
    latestNBA = {
      source: 'askQuestion',
      question: 'Pick a color',
      suggestions: [],
    }

    renderBar()

    expect(screen.getByTestId('commander-mobile-chat-question-badge')).toBeInTheDocument()
  })

  it('does not show a badge for suggested response NBAs', function suggestedResponseNoBadge(): void {
    initialBuildActive = true
    latestNBA = {
      source: 'suggestedResponse',
      question: 'What next?',
      suggestions: [{ text: 'Keep building' }],
    }

    renderBar()

    expect(screen.queryByTestId('commander-mobile-chat-question-badge')).not.toBeInTheDocument()
  })

  it('does not show a badge outside the initial build', function outsideInitialBuildNoBadge(): void {
    latestNBA = {
      source: 'askQuestion',
      question: 'Pick a color',
      suggestions: [],
    }

    renderBar()

    expect(screen.queryByTestId('commander-mobile-chat-question-badge')).not.toBeInTheDocument()
  })

  it('does not show a badge while a tool is still running', function runningToolNoBadge(): void {
    initialBuildActive = true
    activeRunningToolName = 'writeFiles'
    latestNBA = {
      source: 'askQuestion',
      question: 'Pick a color',
      suggestions: [],
    }

    renderBar()

    expect(screen.queryByTestId('commander-mobile-chat-question-badge')).not.toBeInTheDocument()
  })
})
