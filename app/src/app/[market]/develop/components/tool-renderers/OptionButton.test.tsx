/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import OptionButton from './OptionButton'

describe('OptionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render without crashing', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render the text prop', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    expect(screen.getByText('Test Option')).toBeInTheDocument()
  })

  it('should call onClick when clicked', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} />
    )

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      expect(onClick).toHaveBeenCalledOnce()
    })
  })

  it('should not call onClick when disabled', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} disabled />
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(onClick).not.toHaveBeenCalled()
  })

  it('should apply disabled styling when disabled', () => {
    const onClick = vi.fn()
    renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} disabled />
    )

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveClass('opacity-50')
    expect(button).toHaveClass('cursor-not-allowed')
    expect(button).toHaveClass('pointer-events-none')
  })

  it('should not show indicator when isSelectable is false', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={false} />
    )

    const indicator = container.querySelector('[aria-hidden="true"]')
    expect(indicator).not.toBeInTheDocument()
  })

  it('should show dot indicator when isSelectable is true and no keyboardShortcut', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={true} />
    )

    const dot = container.querySelector('.size-2.rounded-full')
    expect(dot).toBeInTheDocument()
  })

  it('should show numbered badge when keyboardShortcut is provided', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={true} keyboardShortcut={3} />
    )

    const badge = container.querySelector('.size-2\\.5')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('3')
  })

  it('should not show numbered badge in compact mode', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={true} keyboardShortcut={1} compact />
    )

    const badge = container.querySelector('.size-2\\.5')
    expect(badge).not.toBeInTheDocument()
  })

  it('should apply base button styles', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('flex')
    expect(button).toHaveClass('items-center')
    expect(button).toHaveClass('gap-1.5')
    expect(button).toHaveClass('rounded-md')
    expect(button).toHaveClass('bg-intents-ux-box-backgroundColor')
  })

  it('should apply compact styles when compact is true', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} compact />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('rounded-full')
    expect(button).toHaveClass('whitespace-nowrap')
  })

  it('should apply hover styles', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('hover:bg-muted')
    expect(button).toHaveClass('hover:cursor-pointer')
  })

  it('should have type="button" attribute', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('should apply text styling to the text', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} />
    )

    const textSpan = container.querySelector('span.text-sm.font-medium')
    expect(textSpan).toBeInTheDocument()
    expect(textSpan).toHaveTextContent('Test Option')
  })

  it('should hide indicator from screen readers', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={true} />
    )

    const indicator = container.querySelector('[aria-hidden="true"]')
    expect(indicator).toBeInTheDocument()
  })

  it('should handle multiple clicks', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} />
    )

    const button = screen.getByRole('button')
    await user.click(button)
    await user.click(button)
    await user.click(button)

    await waitFor(() => {
      expect(onClick).toHaveBeenCalledTimes(3)
    })
  })

  it('should handle enabling and disabling', () => {
    const onClick = vi.fn()
    const { rerender } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} disabled={false} />
    )

    let button = screen.getByRole('button')
    expect(button).not.toBeDisabled()

    rerender(<OptionButton text="Test Option" onClick={onClick} disabled={true} />)

    button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should set data-testid when testId is provided', () => {
    const onClick = vi.fn()
    renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} testId="option-button-test-id" />,
    )

    expect(screen.getByTestId('option-button-test-id')).toBeInTheDocument()
    expect(screen.getByTestId('option-button-test-id')).toHaveTextContent('Test Option')
  })
})
