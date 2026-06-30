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
import { COMMANDER_PILL_BOX_SHADOW } from '@/app/[market]/commander/components/commanderSurface'
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

  it('wraps the dock variant in the blurred commander surface with the pill shadow', () => {
    const { container } = renderWithProviders(
      <CanvasActionsBar items={[buttonItem()]} variant={CanvasActionsVariant.Dock} />,
    )
    const outer = container.querySelector('[class*="backdrop-blur"]') as HTMLElement
    expect(outer).toBeInTheDocument()
    expect(outer.style.boxShadow).toBe(COMMANDER_PILL_BOX_SHADOW)
  })

  it('applies purple AI styling (data-partial) when aiStyle is true', () => {
    renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem({ aiStyle: true, active: true })]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button).toHaveAttribute('data-partial', 'componentAiro')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).not.toHaveAttribute('aria-selected')
  })

  it('does not apply data-partial when aiStyle is false', () => {
    const { container } = renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem({ active: true })]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    expect(container.querySelector('[data-partial="componentAiro"]')).toBeNull()
  })

  it('uses UX control chosen styling for secondary active via aria-selected', () => {
    renderWithProviders(
      <CanvasActionsBar
        items={[buttonItem({ id: 'select', label: 'Annotate', active: true })]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    const button = screen.getByRole('button', { name: 'Annotate' })
    expect(button).toHaveAttribute('aria-selected', 'true')
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(button).toHaveClass('border-intents-ux-boxHighContrast-borderColor!')
  })

  it('renders dual active edit and annotate states when both modes are on', async () => {
    const onEdit = vi.fn()
    const onAnnotate = vi.fn()
    const { user } = renderWithProviders(
      <CanvasActionsBar
        items={[
          buttonItem({ id: 'edit', label: 'Edit', active: true, aiStyle: true, onTrigger: onEdit }),
          buttonItem({ id: 'select', label: 'Annotate', active: true, onTrigger: onAnnotate }),
        ]}
        variant={CanvasActionsVariant.Inline}
      />,
    )
    const edit = screen.getByRole('button', { name: 'Edit' })
    const annotate = screen.getByRole('button', { name: 'Annotate' })
    expect(edit).toHaveAttribute('data-partial', 'componentAiro')
    expect(edit).toHaveAttribute('aria-pressed', 'true')
    expect(edit).not.toHaveAttribute('aria-selected')
    expect(annotate).toHaveAttribute('aria-selected', 'true')
    expect(annotate).not.toHaveAttribute('aria-pressed')
    expect(annotate).toHaveClass('border-intents-ux-boxHighContrast-borderColor!')
    await user.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onAnnotate).not.toHaveBeenCalled()
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
