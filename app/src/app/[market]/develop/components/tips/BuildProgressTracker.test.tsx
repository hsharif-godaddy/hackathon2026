/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import BuildProgressTracker from './BuildProgressTracker'
import { STAGE_DURATION_MS } from './useProgressTracker'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _params: unknown, defaultMsg?: string) => defaultMsg ?? key,
}))

describe('BuildProgressTracker', function trackerTests() {
  beforeEach(function setup() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(function teardown() {
    vi.useRealTimers()
  })

  it('renders all five stage circles', function rendersFiveStages() {
    renderWithProviders(<BuildProgressTracker />)

    expect(screen.getByTestId('progress-stage-understanding')).toBeInTheDocument()
    expect(screen.getByTestId('progress-stage-strategy')).toBeInTheDocument()
    expect(screen.getByTestId('progress-stage-structure')).toBeInTheDocument()
    expect(screen.getByTestId('progress-stage-fonts')).toBeInTheDocument()
    expect(screen.getByTestId('progress-stage-finishing')).toBeInTheDocument()
  })

  it('marks the first stage as active on mount', function firstStageActive() {
    renderWithProviders(<BuildProgressTracker />)

    // 4 ticks × 200ms = 800ms intro delay consumed
    act(() => { vi.advanceTimersByTime(800) })

    expect(screen.getByTestId('progress-stage-understanding')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('progress-stage-strategy')).not.toHaveAttribute('aria-current')
  })

  it('advances to the second stage after one interval', function advancesAfterInterval() {
    renderWithProviders(<BuildProgressTracker />)

    act(() => { vi.advanceTimersByTime(800 + STAGE_DURATION_MS) })

    expect(screen.getByTestId('progress-stage-understanding')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('progress-stage-strategy')).toHaveAttribute('aria-current', 'step')
  })

  it('reaches the final stage after four intervals', function reachesFinalStage() {
    renderWithProviders(<BuildProgressTracker />)

    act(() => { vi.advanceTimersByTime(800 + STAGE_DURATION_MS * 4) })

    expect(screen.getByTestId('progress-stage-finishing')).toHaveAttribute('aria-current', 'step')
  })

  it('does not advance past the final stage', function stopsAtFinalStage() {
    renderWithProviders(<BuildProgressTracker />)

    act(() => { vi.advanceTimersByTime(800 + STAGE_DURATION_MS * 10) })

    expect(screen.getByTestId('progress-stage-finishing')).toHaveAttribute('aria-current', 'step')
  })

  it('creeps the trailing bar forward past the final stage without resetting or filling fully', function trailingCreep() {
    renderWithProviders(<BuildProgressTracker />)
    const fillWidth = (): number =>
      parseFloat(screen.getByTestId('progress-trailing-fill').style.width || '0')

    // Before the final stage, the trailing bar is empty.
    act(() => { vi.advanceTimersByTime(800) })
    expect(fillWidth()).toBe(0)

    // A bit past all five stages (~5 min), the trailing bar has started to fill.
    act(() => { vi.advanceTimersByTime(STAGE_DURATION_MS * 5 + STAGE_DURATION_MS) })
    const early = fillWidth()
    expect(early).toBeGreaterThan(0)

    // It keeps creeping forward (monotonic — never bounces back)...
    act(() => { vi.advanceTimersByTime(STAGE_DURATION_MS * 2) })
    const later = fillWidth()
    expect(later).toBeGreaterThan(early)

    // ...but never completes, even after a long wait.
    act(() => { vi.advanceTimersByTime(STAGE_DURATION_MS * 30) })
    expect(fillWidth()).toBeLessThan(100)
  })

  it('renders stage labels from i18n defaults', function rendersLabels() {
    renderWithProviders(<BuildProgressTracker />)

    expect(screen.getByText('Understanding your idea')).toBeInTheDocument()
    expect(screen.getByText('Creating strategy')).toBeInTheDocument()
    expect(screen.getByText('Defining structure')).toBeInTheDocument()
    expect(screen.getByText('Adding fonts and colors')).toBeInTheDocument()
    expect(screen.getByText('Finishing touches')).toBeInTheDocument()
  })
})
