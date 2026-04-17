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

  it('should not show radio circle when isSelectable is false', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={false} />
    )

    const radioCircle = container.querySelector('.size-2.rounded-full')
    expect(radioCircle).not.toBeInTheDocument()
  })

  it('should show radio circle when isSelectable is true', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={true} />
    )

    const radioCircle = container.querySelector('.size-2.rounded-full')
    expect(radioCircle).toBeInTheDocument()
  })

  it('should show empty radio circle when isSelectable is true but not selected', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton
        text="Test Option"
        onClick={onClick}
        isSelectable={true}
        isSelected={false}
      />
    )

    const outerCircle = container.querySelector('.size-2.rounded-full')
    const innerDot = container.querySelector('.size-1.rounded-full')

    expect(outerCircle).toBeInTheDocument()
    expect(innerDot).not.toBeInTheDocument()
  })

  it('should show filled radio circle when isSelected is true', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton
        text="Test Option"
        onClick={onClick}
        isSelectable={true}
        isSelected={true}
      />
    )

    const outerCircle = container.querySelector('.size-2.rounded-full')
    const innerDot = container.querySelector('.size-1.rounded-full')

    expect(outerCircle).toBeInTheDocument()
    expect(innerDot).toBeInTheDocument()
  })

  it('should not show inner dot when isSelected is true but isSelectable is false', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton
        text="Test Option"
        onClick={onClick}
        isSelectable={false}
        isSelected={true}
      />
    )

    const radioCircle = container.querySelector('.size-2.rounded-full')
    const innerDot = container.querySelector('.size-1.rounded-full')

    expect(radioCircle).not.toBeInTheDocument()
    expect(innerDot).not.toBeInTheDocument()
  })

  it('should apply base button styles', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('flex')
    expect(button).toHaveClass('items-center')
    expect(button).toHaveClass('gap-1')
    expect(button).toHaveClass('rounded-lg')
    expect(button).toHaveClass('bg-intents-ux-box-backgroundColor')
  })

  it('should apply hover styles', () => {
    const onClick = vi.fn()
    renderWithProviders(<OptionButton text="Test Option" onClick={onClick} />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('hover:border-intents-ux-boxHighContrast-borderColor')
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

  it('should hide radio circle aria indicator', () => {
    const onClick = vi.fn()
    const { container } = renderWithProviders(
      <OptionButton text="Test Option" onClick={onClick} isSelectable={true} />
    )

    const radioContainer = container.querySelector('[aria-hidden="true"]')
    expect(radioContainer).toBeInTheDocument()
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

  it('should handle state changes from unselected to selected', () => {
    const onClick = vi.fn()
    const { rerender, container } = renderWithProviders(
      <OptionButton
        text="Test Option"
        onClick={onClick}
        isSelectable={true}
        isSelected={false}
      />
    )

    let innerDot = container.querySelector('.size-1.rounded-full')
    expect(innerDot).not.toBeInTheDocument()

    rerender(
      <OptionButton
        text="Test Option"
        onClick={onClick}
        isSelectable={true}
        isSelected={true}
      />
    )

    innerDot = container.querySelector('.size-1.rounded-full')
    expect(innerDot).toBeInTheDocument()
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
})
