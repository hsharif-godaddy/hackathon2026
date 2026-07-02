/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import OptionInput from './OptionInput'

describe('OptionInput', () => {
  const mockProps = {
    value: '',
    disabled: false,
    placeholder: 'Enter text',
    ariaLabel: 'Input label',
    submitLabel: 'Submit',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onKeyDown: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render without crashing', () => {
    renderWithProviders(<OptionInput {...mockProps} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should display the placeholder', () => {
    renderWithProviders(<OptionInput {...mockProps} />)

    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
  })

  it('should display the input value', () => {
    renderWithProviders(<OptionInput {...mockProps} value="test value" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('test value')
  })

  it('should call onChange when typing', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <OptionInput {...mockProps} onChange={onChange} />
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'hello')

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
  })

  it('should call onFocus when input gains focus', async () => {
    const onFocus = vi.fn()
    const { user } = renderWithProviders(
      <OptionInput {...mockProps} onFocus={onFocus} />
    )

    const input = screen.getByRole('textbox')
    await user.click(input)

    await waitFor(() => {
      expect(onFocus).toHaveBeenCalledOnce()
    })
  })

  it('should call onKeyDown when pressing keys', async () => {
    const onKeyDown = vi.fn()
    const { user } = renderWithProviders(
      <OptionInput {...mockProps} onKeyDown={onKeyDown} />
    )

    const input = screen.getByRole('textbox')
    await user.type(input, '{Enter}')

    await waitFor(() => {
      expect(onKeyDown).toHaveBeenCalled()
    })
  })

  it('should call onSubmit when submit button is clicked', async () => {
    const onSubmit = vi.fn()
    const { user } = renderWithProviders(
      <OptionInput {...mockProps} value="test" onSubmit={onSubmit} />
    )

    const button = screen.getByRole('button')
    await user.click(button)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce()
    })
  })

  it('should not call onSubmit when input is empty', async () => {
    const onSubmit = vi.fn()
    const { user } = renderWithProviders(
      <OptionInput {...mockProps} value="" onSubmit={onSubmit} />
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('should not call onSubmit when input has only whitespace', async () => {
    const onSubmit = vi.fn()
    const { user } = renderWithProviders(
      <OptionInput {...mockProps} value="   " onSubmit={onSubmit} />
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('should disable submit button when input is empty', () => {
    renderWithProviders(<OptionInput {...mockProps} value="" />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should enable submit button when input has value', () => {
    renderWithProviders(<OptionInput {...mockProps} value="test" />)

    const button = screen.getByRole('button')
    expect(button).not.toBeDisabled()
  })

  it('should disable input when disabled prop is true', () => {
    renderWithProviders(<OptionInput {...mockProps} disabled={true} />)

    const input = screen.getByRole('textbox')
    expect(input).toBeDisabled()
  })

  it('should disable submit button when disabled prop is true', () => {
    renderWithProviders(<OptionInput {...mockProps} disabled={true} value="test" />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should not show any indicator when no keyboardShortcut', () => {
    const { queryByText } = renderWithProviders(<OptionInput {...mockProps} />)

    expect(queryByText('1')).not.toBeInTheDocument()
  })

  it('should show numbered badge when keyboardShortcut is provided', () => {
    const { getByText } = renderWithProviders(
      <OptionInput {...mockProps} keyboardShortcut={2} />
    )

    expect(getByText('2')).toBeInTheDocument()
  })

  it('should set input aria-label', () => {
    renderWithProviders(
      <OptionInput {...mockProps} ariaLabel="Custom input label" />
    )

    const input = screen.getByRole('textbox', { name: 'Custom input label' })
    expect(input).toBeInTheDocument()
  })

  it('should set button aria-label', () => {
    renderWithProviders(
      <OptionInput {...mockProps} value="test" submitLabel="Custom submit" />
    )

    const button = screen.getByRole('button', { name: 'Custom submit' })
    expect(button).toBeInTheDocument()
  })

  it('should apply base container styles', () => {
    const { container } = renderWithProviders(<OptionInput {...mockProps} />)

    const wrapper = container.querySelector('.flex.items-center.gap-2')
    expect(wrapper).toHaveClass('bg-intents-ux-box-backgroundColor')
    expect(wrapper).toHaveClass('rounded-md')
  })

  it('should apply input styles', () => {
    renderWithProviders(<OptionInput {...mockProps} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveClass('text-sm')
    expect(input).toHaveClass('grow')
    expect(input).toHaveClass('border-0')
  })

  it('should apply button hover styles', () => {
    renderWithProviders(<OptionInput {...mockProps} value="test" />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('hover:cursor-pointer')
    expect(button).toHaveClass('disabled:opacity-50')
    expect(button).toHaveClass('disabled:cursor-not-allowed')
  })

  it('should handle state changes from empty to filled', () => {
    const { rerender } = renderWithProviders(<OptionInput {...mockProps} value="" />)

    let button = screen.getByRole('button')
    expect(button).toBeDisabled()

    rerender(<OptionInput {...mockProps} value="test" />)

    button = screen.getByRole('button')
    expect(button).not.toBeDisabled()
  })

  it('should handle enabling and disabling', () => {
    const { rerender } = renderWithProviders(
      <OptionInput {...mockProps} disabled={false} />
    )

    let input = screen.getByRole('textbox')
    expect(input).not.toBeDisabled()

    rerender(<OptionInput {...mockProps} disabled={true} />)

    input = screen.getByRole('textbox')
    expect(input).toBeDisabled()
  })

  it('should render ArrowRight icon in submit button', () => {
    renderWithProviders(<OptionInput {...mockProps} value="test" />)

    const button = screen.getByRole('button')
    const svg = button.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })
})
