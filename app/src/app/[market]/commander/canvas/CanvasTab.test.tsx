/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { CanvasTab } from './CanvasTab'
import { CanvasId } from './registry'

const Icon = () => <svg data-testid="canvas-icon" />

const baseProps = {
  canvasId: CanvasId.Brand,
  icon: <Icon />,
  label: 'Brand & Logo',
  active: false,
  dismissible: true,
  collapseLabel: false,
  closeLabel: 'Close tab',
  testId: 'tab',
  onActivate: vi.fn(),
}

describe('CanvasTab', () => {
  it('calls onActivate when the tab is clicked', async () => {
    const onActivate = vi.fn()
    const { user } = renderWithProviders(
      <CanvasTab {...baseProps} onActivate={onActivate} />,
    )
    await user.click(screen.getByRole('tab', { name: 'Brand & Logo' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('does not render a close button when not dismissible', () => {
    renderWithProviders(<CanvasTab {...baseProps} dismissible={false} />)
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument()
  })

  it('renders a close button on dismissible tabs that fires onClose without bubbling', async () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <CanvasTab {...baseProps} onActivate={onActivate} onClose={onClose} />,
    )
    const closeButton = screen.getByRole('button', { name: 'Close tab' })
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })
})
