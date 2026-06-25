/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

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

  it('does not render a close button on inactive dismissible tabs', () => {
    renderWithProviders(
      <CanvasTab {...baseProps} onClose={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument()
  })

  it('renders a close button on active dismissible tabs that fires onClose without bubbling', async () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <CanvasTab {...baseProps} active onActivate={onActivate} onClose={onClose} />,
    )
    const closeButton = screen.getByRole('button', { name: 'Close tab' })
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('reveals the close button on hover for active tabs but not on tab keyboard focus alone', () => {
    renderWithProviders(<CanvasTab {...baseProps} active onClose={vi.fn()} />)
    const closeButton = screen.getByRole('button', { name: 'Close tab' })
    expect(closeButton.className).toContain('group-hover:opacity-100')
    expect(closeButton.className).not.toContain('group-focus-within:opacity-100')
    expect(closeButton.className).toContain('focus-visible:opacity-100')
  })

  it('closes the tab from the keyboard without activating it', async () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <CanvasTab {...baseProps} active onActivate={onActivate} onClose={onClose} />,
    )
    const closeButton = screen.getByRole('button', { name: 'Close tab' })

    closeButton.focus()
    expect(closeButton).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('keeps the tab icon visible when an active tab receives keyboard focus', () => {
    renderWithProviders(<CanvasTab {...baseProps} active onClose={vi.fn()} />)
    const tab = screen.getByRole('tab', { name: 'Brand & Logo' })
    tab.focus()
    expect(tab).toHaveFocus()
    expect(screen.getByTestId('canvas-icon')).toBeInTheDocument()
    const iconWrapper = screen.getByTestId('canvas-icon').parentElement
    expect(iconWrapper?.className).toContain('group-hover:opacity-0')
    expect(iconWrapper?.className).toContain('group-has-[button:focus-visible]:opacity-0')
  })

  it('does not render a close button on inactive tabs when collapseLabel is true', () => {
    renderWithProviders(
      <CanvasTab {...baseProps} collapseLabel onClose={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument()
  })

  it('renders a hover close button on active tabs when collapseLabel is true', () => {
    renderWithProviders(
      <CanvasTab {...baseProps} active collapseLabel onClose={vi.fn()} />,
    )
    const closeButton = screen.getByRole('button', { name: 'Close tab' })
    expect(closeButton.className).toContain('group-hover:opacity-100')
    expect(closeButton.className).not.toContain('group-focus-within:opacity-100')
  })

  it('does not reveal the label on hover when collapseLabel is true', () => {
    renderWithProviders(<CanvasTab {...baseProps} collapseLabel />)
    const tab = screen.getByRole('tab', { name: 'Brand & Logo' })
    fireEvent.mouseEnter(tab)
    const labelSpan = screen.getByText('Brand & Logo')
    expect(labelSpan).toHaveAttribute('aria-hidden', 'true')
    expect(labelSpan).toHaveClass('max-w-0')
  })

  it('keeps the label collapsed when the tab is active and collapseLabel is true', () => {
    renderWithProviders(
      <CanvasTab {...baseProps} active collapseLabel onActivate={vi.fn()} />,
    )
    const labelSpan = screen.getByText('Brand & Logo')
    expect(labelSpan).toHaveAttribute('aria-hidden', 'true')
    expect(labelSpan).toHaveClass('max-w-0')
  })
})
