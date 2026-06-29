/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import {
  type CanvasActionItem,
  CanvasActionItemType,
  CanvasActionsVariant,
} from '@/app/[market]/commander/canvas/actions'
import { renderWithProviders } from '@/tests/test-utils'
import CanvasActionsBar from './CanvasActionsBar'

function buttonItem(overrides: Partial<CanvasActionItem> = {}): CanvasActionItem {
  return {
    type: CanvasActionItemType.Button,
    id: 'edit',
    icon: <svg data-testid="edit-icon" />,
    label: 'Edit',
    onTrigger: vi.fn(),
    ...overrides,
  } as CanvasActionItem
}

describe('CanvasActionsBar', () => {
  it('renders nothing when there are no items', () => {
    const { container } = renderWithProviders(
      <CanvasActionsBar items={[]} variant={CanvasActionsVariant.Inline} />,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders a labelled button and fires its handler on click', async () => {
    const onTrigger = vi.fn()
    const { user } = renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem({ onTrigger })]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    const button = screen.getByRole('button', { name: 'Edit' })
    await user.click(button)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('exposes an accessible name even when the label is hidden', () => {
    renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem({ id: 'refresh', label: 'Refresh', labelHidden: true })]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('disables a button when the item is disabled', () => {
    renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem({ id: 'undo', label: 'Undo', labelHidden: true, disabled: true })]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('renders a separator as an aria-hidden element', () => {
    const { container } = renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem(), { type: CanvasActionItemType.Separator }]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('wraps the dock variant in the blurred commander surface', () => {
    const { container } = renderWithProviders(
      <CanvasActionsBar items={[buttonItem()]} variant={CanvasActionsVariant.Dock} />,
    )
    expect(container.querySelector('[class*="backdrop-blur"]')).toBeInTheDocument()
  })

  it('renders a menu trigger and opens its options on click', async () => {
    const onSelect = vi.fn()
    const menu: CanvasActionItem = {
      type: CanvasActionItemType.Menu,
      id: 'device',
      icon: <svg data-testid="device-icon" />,
      label: 'Change device',
      options: [
        { id: 'desktop', label: 'Desktop', active: true, onSelect: vi.fn() },
        { id: 'mobile', label: 'Mobile', active: false, onSelect },
      ],
    }
    const { user } = renderWithProviders(
      <CanvasActionsBar items={[menu]} variant={CanvasActionsVariant.Inline} />,
    )
    await user.click(screen.getByRole('button', { name: 'Change device' }))
    const mobileOption = await screen.findByRole('button', { name: 'Mobile' })
    await user.click(mobileOption)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
