/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import PreviewLoadingState from './PreviewLoadingState'

vi.mock('@/app/[market]/develop/components/tips/Tips', () => ({
  default: ({
    buildingMessage,
    timeEstimateMinutes,
    onTimeEstimateShown,
  }: {
    buildingMessage?: string
    timeEstimateMinutes?: number | null
    onTimeEstimateShown?: () => void
  }) => {
    // Mirror the real Tips: it invokes onTimeEstimateShown only when the pill renders.
    if (timeEstimateMinutes != null) {
      onTimeEstimateShown?.()
    }
    return (
      <div data-testid="tips" data-time-estimate-minutes={timeEstimateMinutes ?? ''}>
        {buildingMessage ?? 'Tips'}
      </div>
    )
  },
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (s: unknown) => unknown) =>
    selector({ previewViewMode: 'DESKTOP', selectedDeviceId: 'full' }),
}))

describe('PreviewLoadingState', () => {
  it('forwards timeEstimateMinutes to Tips when provided', () => {
    renderWithProviders(<PreviewLoadingState message="Building your App" timeEstimateMinutes={5} />)

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '5')
  })

  it('passes null to Tips when timeEstimateMinutes is omitted', () => {
    renderWithProviders(<PreviewLoadingState message="Resuming" />)

    expect(screen.getByTestId('tips')).toHaveAttribute('data-time-estimate-minutes', '')
  })

  it('forwards onTimeEstimateShown to Tips when the pill renders', () => {
    const onTimeEstimateShown = vi.fn()
    renderWithProviders(
      <PreviewLoadingState message="Building your App" timeEstimateMinutes={5} onTimeEstimateShown={onTimeEstimateShown} />,
    )

    expect(onTimeEstimateShown).toHaveBeenCalled()
  })

  it('does not invoke onTimeEstimateShown when no estimate is shown', () => {
    const onTimeEstimateShown = vi.fn()
    renderWithProviders(
      <PreviewLoadingState message="Resuming" onTimeEstimateShown={onTimeEstimateShown} />,
    )

    expect(onTimeEstimateShown).not.toHaveBeenCalled()
  })
})
