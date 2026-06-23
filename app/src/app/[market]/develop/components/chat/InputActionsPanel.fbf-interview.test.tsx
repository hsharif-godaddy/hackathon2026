/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import * as Switchboard from '@/hooks/useSwitchboard'
import { markFeedbackRevealMilestone } from '@/lib/initial-build-reveal-storage'
import * as DevelopPageStore from '@/stores/useDevelopPageStore'
import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'
import * as StreamingStore from '@/stores/useStreamingConversationStore'
import * as TodoListStore from '@/stores/useTodoListStore'
import { renderWithProviders } from '@/tests/test-utils'
import * as ChatContext from './ChatContext'
import InputActionsPanel from './InputActionsPanel'

// AIROBUILD-2665 / Fix A1 — REGRESSION TEST for the First-Build-Feedback (FBF)
// suppression of the kit-attach interview card. Unlike the sibling
// InputActionsPanel.test.tsx, this suite uses the REAL useLatestNBAs and the REAL
// useFirstBuildFeedback hooks so the full dispatcher → ThemeSelection →
// useLatestNBAs(feedbackActive) → suppressNBA chain (where the bug lived) is
// exercised end-to-end. Only the leaf stores / switchboard / CDS widgets are mocked.

// ─── Streaming store: real useLatestNBAs reads useMessages + useActiveStream +
//     the resolvedSecretsComposerToolCallIds selector. The panel also reads
//     useIsActivelyStreaming / useIsLoading. ───────────────────────────────────
let mockMessages: ChatMessage[] = []
let mockActiveStream: StreamingMessage | null = null

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useMessages: vi.fn(() => mockMessages),
  useActiveStream: vi.fn(() => mockActiveStream),
  useIsActivelyStreaming: vi.fn(() => false),
  useIsLoading: vi.fn(() => false),
  useActiveRunningToolName: vi.fn(() => null),
  useActiveAwaitAgentsCount: vi.fn(() => 0),
  useAwaitedJobResult: vi.fn(() => undefined),
  useStreamingConversationStore: (selector: (s: { resolvedSecretsComposerToolCallIds: Record<string, true> }) => unknown) =>
    selector({ resolvedSecretsComposerToolCallIds: {} }),
}))

vi.mock('@/app/[market]/develop/hooks/useRebuildPages', async function importRebuildPages() {
  const actual = await vi.importActual<typeof import('@/app/[market]/develop/hooks/useRebuildPages')>(
    '@/app/[market]/develop/hooks/useRebuildPages',
  )
  return {
    ...actual,
    useRebuildPages: vi.fn(function () { return { data: null, isLoading: false }; }),
  }
})

vi.mock('@/stores/useUpfrontRebuildBuildQueueStore', () => ({
  useUpfrontRebuildBuildQueueStore: vi.fn((selector: any) =>
    selector({ queues: {}, isPlanInProgress: () => false }),
  ),
}))

vi.mock('@/stores/useTodoListStore', () => ({
  useCurrentList: vi.fn(() => null),
  useViewState: vi.fn(() => null),
  useTodoListStore: {
    getState: vi.fn(function () { return { currentList: null, setCurrentList: vi.fn() }; }),
  },
}))

vi.mock('./ChatContext', () => ({
  useSendUserMessage: vi.fn(() => vi.fn()),
}))

vi.mock('@/app/[market]/develop/components/chat/secrets/useSecretsComposerTakeover', () => ({
  useSecretsComposerTakeover: vi.fn(() => null),
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-id'),
}))

vi.mock('@/app/[market]/develop/hooks/useNextActions', () => ({
  useNextActions: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(),
}))

vi.mock('@/app/[market]/develop/components/utils/previewThemeInIframe', () => ({
  previewThemeInIframe: vi.fn(),
}))

vi.mock('@airo-ux/pattern-library/chat/thinker', () => ({
  Thinker: () => <div data-testid="thinking-indicator" />,
}))

vi.mock('@airo-ux/pattern-library/primitives/thinking-indicator', () => ({
  ThinkingIndicator: () => <div data-testid="thinking-indicator-spinner" />,
}))

vi.mock('@ux/listbox', () => ({
  default: ({ items, onConfirm, selected, ref: listboxRef, ...rest }: any) => (
    <div role="listbox" ref={listboxRef} {...rest}>
      {items?.map((item: any) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={selected === item.id ? 'true' : 'false'}
          onClick={() => onConfirm?.(item.id, { event: null })}
        >
          {item.children}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@ux/text-entry', () => ({
  default: ({ value, onChange, placeholder, 'aria-label': ariaLabel, ...rest }: any) => (
    <input
      role="textbox"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      {...rest}
    />
  ),
}))

const INTERVIEW_QUESTION = 'What palette best fits your brand?'

function parkedAskQuestionMessage(): ChatMessage {
  return {
    id: 'msg-interview',
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    toolCalls: [
      {
        id: 'tc-aq-interview',
        name: 'askQuestion',
        status: 'completed',
        input: {},
        result: {
          output: {
            widgetType: 'ask-question',
            widgetData: {
              type: 'ask-question',
              currentQuestionIndex: 0,
              answers: [],
              questions: [
                {
                  question: INTERVIEW_QUESTION,
                  suggestions: [{ text: 'Warm & earthy' }, { text: 'Cool & modern' }],
                  allowOther: true,
                },
              ],
            },
          },
        },
      },
    ],
  }
}

function setStoreApp(initialBuildComplete: boolean): void {
  vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) {
    return selector({
      viewMode: ViewMode.PREVIEW,
      isMobile: false,
      app: { id: 'test-app-id', initialBuildComplete },
    })
  })
}

// Flags ON in prod & dev (verified in the plan doc): FBF + theme-selection-chat.
function setFlags(): void {
  vi.mocked(Switchboard.useSwitchboard).mockImplementation(function (flag: string) {
    if (flag === 'appbuilder-first-build-feedback') return true
    if (flag === 'airo-builder-theme-selection-chat') return true
    return false
  })
}

describe('InputActionsPanel — FBF must not suppress the kit-attach interview card (AIROBUILD-2665 A1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockActiveStream = null
    mockMessages = [parkedAskQuestionMessage()]
    setFlags()
    vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(vi.fn())
    vi.mocked(TodoListStore.useCurrentList).mockReturnValue(null)
    vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
  })

  it('renders the parked askQuestion card live when initialBuildComplete stays false (post-fix: A1 does not flip it on a parked turn)', () => {
    // A1 keeps postInitialBuildEvent from firing on a parked-askQuestion turn, so the
    // client store mirrors the server: initialBuildComplete=false during the interview.
    // FBF therefore stays inactive (its gate requires initialBuildComplete) and the card renders.
    setStoreApp(false)

    renderWithProviders(<InputActionsPanel />)

    expect(screen.getByText(INTERVIEW_QUESTION)).toBeInTheDocument()
    expect(screen.getByTestId('input-actions-panel-card')).toBeInTheDocument()
  })

  it('still renders the interview card when initialBuildComplete is prematurely true but no agent file edit occurred', () => {
    // Old behavior (pre firstFileEdit gate): initialBuildComplete=true alone activated
    // FBF and suppressed this card. FBF now also requires firstFileEdit, so a premature
    // complete flag during kit-attach interview must not hide the askQuestion card.
    setStoreApp(true)

    renderWithProviders(<InputActionsPanel />)

    expect(screen.getByText(INTERVIEW_QUESTION)).toBeInTheDocument()
    expect(screen.getByTestId('input-actions-panel-card')).toBeInTheDocument()
  })

  it('suppresses the interview card when FBF is legitimately active (build complete and first file edit)', () => {
    markFeedbackRevealMilestone('test-app-id', 'firstFileEdit')
    setStoreApp(true)

    renderWithProviders(<InputActionsPanel />)

    expect(screen.queryByText(INTERVIEW_QUESTION)).not.toBeInTheDocument()
    expect(screen.queryByTestId('input-actions-panel-card')).not.toBeInTheDocument()
  })

  it('renders the interview card even with FBF flag on, as long as the build is not (prematurely) marked complete', () => {
    // Belt-and-suspenders: the FBF switchboard flag being ON (prod parity) is not
    // itself the problem — the premature initialBuildComplete flip is. With the flag
    // on but the build not marked complete, the card still renders.
    setStoreApp(false)

    renderWithProviders(<InputActionsPanel />)

    expect(screen.getByText(INTERVIEW_QUESTION)).toBeInTheDocument()
  })
})
