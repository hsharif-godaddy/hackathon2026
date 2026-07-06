/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { forwardRef, type ReactElement, type ReactNode, type Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { LatestNBAData } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { renderWithProviders } from '@/tests/test-utils'
import { CommanderMobileBar } from './CommanderMobileBar'
import { CanvasId, PINNED_CANVAS_ID } from '../canvas/registry'

const { badgeMapRef } = vi.hoisted(() => ({
  badgeMapRef: { current: {} as Partial<Record<CanvasId, ReactElement | null>> },
}))

let latestNBA: LatestNBAData | null = null
let initialBuildActive = false
let initialBuildComplete = false
let activeRunningToolName: string | null = null
let isLoading = false

vi.mock('../canvas/badgeProviders', () => ({
  useCanvasBadgeMap: () => badgeMapRef.current,
}))

// Stub the sheet: it renders BottomSheet + its own badge map, neither of which
// this test exercises — we only care about the selector's badge/dot branching.
vi.mock('../canvas/CommanderCanvasSheet', () => ({
  CommanderCanvasSheet: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@ux/button', () => ({
  default: forwardRef(function MockButton(
    {
      icon,
      text,
      onClick,
      ...rest
    }: { icon?: ReactNode; text?: ReactNode; onClick?: () => void; [key: string]: unknown },
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
  useSwitchboard: () => true,
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: () => () => {},
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useActiveRunningToolName: () => activeRunningToolName,
  useIsLoading: () => isLoading,
}))

const SELECTOR_TESTID = 'commander-mobile-canvas-selector'
const DOT_TESTID = 'commander-mobile-canvas-selector-badge'
const BADGE_NODE_TESTID = 'active-badge-node'

const badgeNode = <span data-testid={BADGE_NODE_TESTID}>1</span>

function renderBar(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<CommanderMobileBar />)
}

beforeEach(function reset(): void {
  latestNBA = null
  initialBuildActive = false
  initialBuildComplete = false
  activeRunningToolName = null
  isLoading = false
  badgeMapRef.current = {}
  useCommanderStore.setState({
    activeCanvasId: PINNED_CANVAS_ID,
    openCanvasIds: [CanvasId.Preview],
  })
})

describe('CommanderMobileBar chat question badge', () => {
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

describe('CommanderMobileBar badge indicators', () => {
  it("renders the active canvas's own badge on the selector (no fallback dot)", () => {
    useCommanderStore.setState({ activeCanvasId: CanvasId.Inbox })
    badgeMapRef.current = { [CanvasId.Inbox]: badgeNode }

    renderWithProviders(<CommanderMobileBar />)

    expect(screen.getByTestId(SELECTOR_TESTID)).toBeInTheDocument()
    expect(screen.getByTestId(BADGE_NODE_TESTID)).toBeInTheDocument()
    expect(screen.queryByTestId(DOT_TESTID)).not.toBeInTheDocument()
  })

  it('shows the fallback dot when a non-active canvas has a badge', () => {
    useCommanderStore.setState({ activeCanvasId: CanvasId.Preview })
    badgeMapRef.current = { [CanvasId.Inbox]: badgeNode }

    renderWithProviders(<CommanderMobileBar />)

    expect(screen.getByTestId(DOT_TESTID)).toBeInTheDocument()
    // The active canvas (Preview) has no badge, so its own badge node is absent.
    expect(screen.queryByTestId(BADGE_NODE_TESTID)).not.toBeInTheDocument()
  })

  it('shows neither badge nor dot when no canvas has a badge', () => {
    useCommanderStore.setState({ activeCanvasId: CanvasId.Preview })
    badgeMapRef.current = {}

    renderWithProviders(<CommanderMobileBar />)

    expect(screen.getByTestId(SELECTOR_TESTID)).toBeInTheDocument()
    expect(screen.queryByTestId(BADGE_NODE_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByTestId(DOT_TESTID)).not.toBeInTheDocument()
  })

  it('does not double-count the active canvas as a hidden badge', () => {
    // Active canvas has a badge and it is the ONLY badge → active-badge branch
    // renders, hidden-dot branch must not (guards against dropping the
    // `!== activeCanvasId` exclusion).
    useCommanderStore.setState({ activeCanvasId: CanvasId.Inbox })
    badgeMapRef.current = { [CanvasId.Inbox]: badgeNode }

    renderWithProviders(<CommanderMobileBar />)

    expect(screen.queryByTestId(DOT_TESTID)).not.toBeInTheDocument()
  })
})
