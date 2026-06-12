/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import RebuildIntakeForm from './RebuildIntakeForm'

const mockMutate = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockTrackFormShown = vi.hoisted(() => vi.fn())
const mockTrackSubmitted = vi.hoisted(() => vi.fn())
const mockTrackWaiting = vi.hoisted(() => vi.fn())
const mockTrackTimedOut = vi.hoisted(() => vi.fn())
const mockTrackFormError = vi.hoisted(() => vi.fn())

const { mockWorkflowStatus } = vi.hoisted(() => ({
  mockWorkflowStatus: { status: 'awaiting_intake' as const, intakeCompleted: false },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

const mockScopeEstimates = [
  {
    scope: 'homepage_only' as const,
    labelKey: 'builder_rebuild_intake_scope_homepage_label',
    descriptionKey: 'builder_rebuild_intake_scope_homepage_description',
    expectedMinutesMin: 3,
    expectedMinutesMax: 8,
    tokenCostMin: 50_000,
    tokenCostMax: 150_000,
    maxPagesToScrape: 1,
    maxPagesToBuildUpfront: 1,
  },
]

vi.mock('@/app/[market]/develop/hooks/useRebuildIntake', () => ({
  useRebuildScopeEstimates: () => ({
    data: mockScopeEstimates,
    isLoading: false,
    isError: false,
  }),
  useRebuildWorkflowStatus: () => ({ data: mockWorkflowStatus }),
  useSubmitRebuildIntake: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>, def?: string) =>
    def ?? (values ? `${key}:${JSON.stringify(values)}` : key),
}))

vi.mock('@/lib/translations/rebuild-intake-defaults', () => ({
  defaultMessageForRebuildIntakeKey: (key: string) => `default:${key}`,
}))

vi.mock('./rebuildIntakeInstrumentation', () => ({
  trackRebuildIntakeFormShown: mockTrackFormShown,
  trackRebuildIntakeSubmitted: mockTrackSubmitted,
  trackRebuildIntakeWaiting: mockTrackWaiting,
  trackRebuildIntakeTimedOut: mockTrackTimedOut,
  trackRebuildIntakeFormError: mockTrackFormError,
}))

vi.mock('@ux/box', () => ({
  default: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
}))

vi.mock('@ux/button', () => ({
  default: ({ text, onClick, ...props }: { text: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick} {...props}>
      {text}
    </button>
  ),
}))

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
    span: ({ children, ...props }: React.ComponentProps<'span'>) => <span {...props}>{children}</span>,
  },
}))

describe('RebuildIntakeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStatus.intakeCompleted = false
    mockWorkflowStatus.status = 'awaiting_intake'
  })

  it('renders intake form with scope and design sections', function renderForm() {
    render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    expect(mockTrackWaiting).toHaveBeenCalledWith('https://example.com')
    expect(mockTrackFormShown).toHaveBeenCalledWith('https://example.com')
    expect(screen.getByTestId('rebuild-intake-form')).toBeInTheDocument()
    expect(screen.getByText('default:builder_rebuild_intake_scope_homepage_label')).toBeInTheDocument()
    expect(screen.getByText('default:builder_rebuild_intake_design_heading')).toBeInTheDocument()
  })

  it('shows time estimate without token cost', function timeEstimate() {
    render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    const text = screen.getByTestId('rebuild-intake-form').textContent ?? ''
    expect(text).toContain('builder_rebuild_intake_estimate_time')
    expect(text).not.toContain('builder_rebuild_intake_estimate_tokens')
  })

  it('submits selected scope and design on primary click', async function submit() {
    render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    fireEvent.click(screen.getByTestId('rebuild-intake-submit'))

    expect(mockTrackSubmitted).toHaveBeenCalledWith({
      scope: 'homepage_only',
      designChoice: 'keep_similar',
      designDirection: 'keep-similar',
      submitSource: 'submit',
      sourceUrl: 'https://example.com',
    })

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { scope: 'homepage_only', designDirection: 'keep-similar' },
        expect.any(Object),
      )
    })
  })

  it('submits defaults on secondary click', async function defaults() {
    render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    fireEvent.click(screen.getByTestId('rebuild-intake-use-defaults'))

    expect(mockTrackSubmitted).toHaveBeenCalledWith({
      scope: 'homepage_only',
      designChoice: 'keep_similar',
      designDirection: 'keep-similar',
      submitSource: 'defaults',
      sourceUrl: 'https://example.com',
    })

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { scope: 'homepage_only', designDirection: 'keep-similar' },
        expect.any(Object),
      )
    })
  })

  it('returns null when intake already completed', function completed() {
    mockWorkflowStatus.intakeCompleted = true
    const { container } = render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)
    expect(container.firstChild).toBeNull()
  })

  it('logs timeout when intake completes without user submit', function intakeTimeout() {
    const { rerender } = render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    expect(mockTrackTimedOut).not.toHaveBeenCalled()

    mockWorkflowStatus.intakeCompleted = true
    rerender(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    expect(mockTrackTimedOut).toHaveBeenCalledWith('https://example.com')
  })

  it('does not log timeout after user submits', async function noTimeoutAfterSubmit() {
    const { rerender } = render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    fireEvent.click(screen.getByTestId('rebuild-intake-submit'))

    mockWorkflowStatus.intakeCompleted = true
    rerender(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    expect(mockTrackTimedOut).not.toHaveBeenCalled()
  })

  it('returns null when workflow has already left awaiting_intake', function pastIntake() {
    mockWorkflowStatus.status = 'building'
    const { container } = render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)
    expect(container.firstChild).toBeNull()
  })

  it.each([
    ['default:builder_rebuild_intake_design_airo_decide', 'keep-similar'],
    ['default:builder_rebuild_intake_design_keep_similar', 'keep-similar'],
    ['default:builder_rebuild_intake_design_modernize', 'modernize'],
    ['default:builder_rebuild_intake_design_simplify', 'simplify'],
    ['default:builder_rebuild_intake_design_bold', 'bold'],
  ])('maps design choice %s to %s', async function designDirection(label, expectedDirection) {
    render(<RebuildIntakeForm appId="app-abc" sourceUrl="https://example.com" />)

    fireEvent.click(screen.getByLabelText(label))
    fireEvent.click(screen.getByTestId('rebuild-intake-submit'))

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { scope: 'homepage_only', designDirection: expectedDirection },
        expect.any(Object),
      )
    })
  })
})
