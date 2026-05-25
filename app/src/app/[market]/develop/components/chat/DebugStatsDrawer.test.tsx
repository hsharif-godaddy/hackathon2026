// @vitest-environment jsdom
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent,render, screen } from '@testing-library/react'

import { DebugStatsProvider, useDebugStats } from './DebugStatsContext'
import { DebugStatsPanel,DebugStatsToggleButton } from './DebugStatsDrawer'

vi.mock('@ux/tag', () => ({
  default: ({ children, ...props }: { children: string; [key: string]: unknown }) => <span {...props}>{children}</span>,
}))
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

const mockUseWebSocketState = vi.fn((): { connected: boolean; status: string } => ({ connected: true, status: 'idle' }))
const mockUseStreamingState = vi.fn((): string => 'idle')
const mockUseStreamingConversationStore = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
  selector({
    retryState: { isRetrying: false, retryCount: 0 },
  })
)

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useWebSocketState: () => mockUseWebSocketState(),
  useStreamingState: () => mockUseStreamingState(),
  useStreamingConversationStore: (selector: (s: Record<string, unknown>) => unknown) => mockUseStreamingConversationStore(selector),
}))
import { useSwitchboard } from '@/hooks/useSwitchboard'

function Seed({ withHistory = false }: { withHistory?: boolean }) {
  const { dispatch } = useDebugStats()
  useEffect(() => {
    if (!withHistory) return
    dispatch({
      type: 'LLM_CALL',
      event: {
        type: 'debug_turn_stats',
        conversationId: 'c1',
        agentName: 'main_agent',
        modelName: 'claude-sonnet-4-5',
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        cachedInputTokens: 700,
        cacheWriteInputTokens: 50,
        cacheHitRate: 0.7,
        contextWindowUtilization: 0.1,
        costUsd: 0.0042,
        timestamp: '2026-05-18T12:00:00.000Z',
      },
    })
    dispatch({ type: 'USER_MESSAGE_SENT', sealedAt: '2026-05-18T12:00:01.000Z' })
  }, [dispatch, withHistory])
  return null
}

function Mount({ withHistory = false }: { withHistory?: boolean }) {
  return (
    <DebugStatsProvider>
      <Seed withHistory={withHistory} />
      <DebugStatsToggleButton />
      <DebugStatsPanel />
    </DebugStatsProvider>
  )
}

describe('DebugStats UI', () => {
  it('renders nothing when switchboard flag is off', () => {
    vi.mocked(useSwitchboard).mockReturnValue(false)
    const { container } = render(<Mount />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the toggle button when flag is on and panel is closed', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount />)
    expect(screen.getByTestId('debug-stats-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('debug-stats-panel')).not.toBeInTheDocument()
  })

  it('opens the panel and shows stats from history when toggle is clicked', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount withHistory />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByTestId('debug-stats-panel')).toBeInTheDocument()
    expect(screen.getByTestId('debug-stats-last-cost')).toHaveTextContent('$0.0042')
    expect(screen.getByText(/1000 in \/ 200 out/)).toBeInTheDocument()
    expect(screen.getByText(/hit rate: 70%/)).toBeInTheDocument()
  })

  it('shows placeholder when history is empty', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  it('clicking the toggle a second time closes the panel', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount withHistory />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByTestId('debug-stats-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.queryByTestId('debug-stats-panel')).not.toBeInTheDocument()
  })

  it('CLEAR button resets history', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount withHistory />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    fireEvent.click(screen.getByRole('button', { name: /clear history/i }))
    expect(screen.queryByTestId('debug-stats-last-cost')).not.toBeInTheDocument()
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  it('shows WS transport badge when SSE flag is off', () => {
    vi.mocked(useSwitchboard).mockImplementation((flag: string) =>
      flag === 'app-builder-sse-transport' ? false : true
    )
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByTestId('debug-stats-transport-badge')).toHaveTextContent('WS')
  })

  it('shows connected status badge', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    mockUseWebSocketState.mockReturnValue({ connected: true, status: 'idle' })
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('shows connection status when disconnected', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    mockUseWebSocketState.mockReturnValue({ connected: false, status: 'connecting' })
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText('connecting')).toBeInTheDocument()
  })

  it('shows streaming state badge when active', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    mockUseStreamingState.mockReturnValue('streaming')
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText('streaming')).toBeInTheDocument()
  })

  it('shows retry badge with count', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    mockUseStreamingConversationStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ retryState: { isRetrying: true, retryCount: 3 } })
    )
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText('retry #3')).toBeInTheDocument()
  })
})
