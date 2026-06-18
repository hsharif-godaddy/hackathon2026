// @vitest-environment jsdom
import { type ReactNode,useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { DebugStatsProvider, useDebugStats } from './DebugStatsContext'
import { DebugStatsPanel, DebugStatsToggleButton } from './DebugStatsDrawer'

vi.mock('@ux/tag', () => ({
  default: ({ children, ...props }: { children: string; [key: string]: unknown }) => <span {...props}>{children}</span>,
}))
// FloatingPanel (drag/resize chrome) has its own tests in @airo-ux/pattern-library.
// Mock it to a passthrough so these tests stay focused on the debug-stats content.
vi.mock('@airo-ux/pattern-library/surfaces/floating-panel', () => ({
  FloatingPanel: ({
    show,
    title,
    children,
    footer,
    ...props
  }: {
    show?: boolean
    title?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    [key: string]: unknown
  }) =>
    show === false ? null : (
      <div {...props}>
        <span>{title}</span>
        {children}
        {footer}
      </div>
    ),
}))
vi.mock('@airo-ux/pattern-library/surfaces/floating-panel/styles', () => ({}))
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

const mockUseConnectionState = vi.fn(function () { return { connected: true, status: 'idle' }; })
const mockUseStreamingState = vi.fn(function () { return 'idle'; })

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useConnectionState: () => mockUseConnectionState(),
  useStreamingState: () => mockUseStreamingState(),
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
        agentName: 'sub:design',
        modelName: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        cachedInputTokens: 700,
        cacheWriteInputTokens: 50,
        cacheHitRate: 0.7,
        contextWindowUtilization: 0.1,
        costUsd: 0.0042,
        timestamp: '2026-05-18T12:00:00.000Z',
        steps: 5,
      },
    })
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

  it('opens the panel and shows call table when toggle is clicked', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount withHistory />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByTestId('debug-stats-panel')).toBeInTheDocument()
    expect(screen.getByText('sub:design')).toBeInTheDocument()
    expect(screen.getByText('So4.6')).toBeInTheDocument()
    expect(screen.getByText('$0.0042')).toBeInTheDocument()
  })

  it('shows placeholder when no calls exist', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText(/No LLM calls yet/i)).toBeInTheDocument()
  })

  it('clicking the toggle a second time closes the panel', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount withHistory />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByTestId('debug-stats-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.queryByTestId('debug-stats-panel')).not.toBeInTheDocument()
  })

  it('Clear button resets calls', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    render(<Mount withHistory />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(screen.queryByText('sub:design')).not.toBeInTheDocument()
    expect(screen.getByText(/No LLM calls yet/i)).toBeInTheDocument()
  })

  it('shows connected status badge', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    mockUseConnectionState.mockReturnValue({ connected: true, status: 'idle' })
    render(<Mount />)
    fireEvent.click(screen.getByTestId('debug-stats-toggle'))
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('shows connection status when disconnected', () => {
    vi.mocked(useSwitchboard).mockReturnValue(true)
    mockUseConnectionState.mockReturnValue({ connected: false, status: 'connecting' })
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

})
