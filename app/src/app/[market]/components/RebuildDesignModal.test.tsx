/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import RebuildDesignModal from './RebuildDesignModal'

const mockTrackShown = vi.hoisted(() => vi.fn())
const mockTrackChoice = vi.hoisted(() => vi.fn())

vi.mock('@/app/[market]/develop/components/rebuild/rebuildIntakeInstrumentation', () => ({
  trackRebuildDesignModalShown: mockTrackShown,
  trackRebuildDesignModalChoice: mockTrackChoice,
}))

vi.mock('@ux/icon/arrow-right', () => ({
  default: (props: React.ComponentProps<'svg'>) => <svg {...props} />,
}))

vi.mock('@ux/modal', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div role="dialog">
      <h2>{title}</h2>
      {children}
    </div>
  ),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, def?: string) => def ?? key,
}))

vi.mock('@/lib/translations/rebuild-intake-defaults', () => ({
  defaultMessageForRebuildIntakeKey: (key: string) => `default:${key}`,
}))

vi.mock('@ux/box', () => ({
  default: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
}))

vi.mock('@ux/button', () => ({
  default: ({ text, onClick, disabled, ...props }: { text: string; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>{text}</button>
  ),
}))

vi.mock('@ux/toggle-button', () => ({
  default: ({ active, onClick, ...rest }: { active?: boolean; onClick?: () => void; [key: string]: unknown }) => (
    <button type="button" role="switch" aria-checked={active} onClick={onClick} {...rest} />
  ),
}))

vi.mock('@ux/text', () => ({
  default: {
    span: ({ children, ...props }: React.ComponentProps<'span'>) => <span {...props}>{children}</span>,
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
  },
}))

vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: () => true }))

describe('RebuildDesignModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <RebuildDesignModal open={false} onClose={vi.fn()} onSelect={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows both options with Reimagine listed first', () => {
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={vi.fn()} />)

    const options = screen.getAllByTestId(/^rebuild-design-option-/)
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('data-testid', 'rebuild-design-option-modernize')
    expect(options[1]).toHaveAttribute('data-testid', 'rebuild-design-option-keep-similar')
  })

  it('logs an impression when opened', () => {
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(mockTrackShown).toHaveBeenCalledTimes(1)
  })

  it('disables Continue until a direction is selected, then fires onSelect with the full choice', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={onSelect} />)

    const continueBtn = screen.getByTestId('rebuild-design-continue')
    expect(continueBtn).toBeDisabled()

    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), {
      target: { value: 'https://example.com' },
    })
    fireEvent.click(screen.getByTestId('rebuild-design-option-modernize'))

    expect(continueBtn).not.toBeDisabled()
    expect(onSelect).not.toHaveBeenCalled() // selection alone does not submit

    fireEvent.click(continueBtn)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'modernize' }),
      'https://example.com',
    )
    expect(mockTrackChoice).toHaveBeenCalledWith('modernize')
  })

  it('keeps Continue disabled when a direction is selected but the url is blank', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('rebuild-design-option-keep-similar'))

    const continueBtn = screen.getByTestId('rebuild-design-continue')
    expect(continueBtn).toBeDisabled()
    fireEvent.click(continueBtn)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps Continue disabled when the url is only whitespace', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('rebuild-design-option-modernize'))
    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), {
      target: { value: '   ' },
    })

    expect(screen.getByTestId('rebuild-design-continue')).toBeDisabled()
  })

  it('keeps Continue disabled when the url is not a valid website', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('rebuild-design-option-modernize'))
    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), {
      target: { value: 'asdf' },
    })

    expect(screen.getByTestId('rebuild-design-continue')).toBeDisabled()
  })

  it('accepts a bare domain without a scheme', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={onSelect} />)

    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), {
      target: { value: 'mysite.com' },
    })
    fireEvent.click(screen.getByTestId('rebuild-design-option-modernize'))

    const continueBtn = screen.getByTestId('rebuild-design-continue')
    expect(continueBtn).not.toBeDisabled()
    fireEvent.click(continueBtn)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ direction: 'modernize' }), 'mysite.com')
  })

  it('shows the invalid-url message only after blur, and clears it once valid', () => {
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={vi.fn()} />)
    const input = screen.getByTestId('rebuild-design-url-input')

    fireEvent.change(input, { target: { value: 'asdf' } })
    // Pristine (not blurred) → no error yet, even though it's invalid.
    expect(screen.queryByTestId('rebuild-design-url-error')).toBeNull()

    fireEvent.blur(input)
    expect(screen.getByTestId('rebuild-design-url-error')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'https://example.com' } })
    expect(screen.queryByTestId('rebuild-design-url-error')).toBeNull()
  })

  it('does not show the invalid-url message when the field is blurred while empty', () => {
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={vi.fn()} />)
    const input = screen.getByTestId('rebuild-design-url-input')

    fireEvent.focus(input)
    fireEvent.blur(input)

    expect(screen.queryByTestId('rebuild-design-url-error')).toBeNull()
  })

  it('pre-fills url and pre-selects direction from props (deep link)', () => {
    const onSelect = vi.fn()
    render(
      <RebuildDesignModal
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        initialUrl="https://example.com"
        initialDirection="keep-similar"
      />,
    )

    expect((screen.getByTestId('rebuild-design-url-input') as HTMLInputElement).value).toBe('https://example.com')
    // Pre-selected → Continue immediately enabled and commits the pre-set direction.
    expect(screen.getByTestId('rebuild-design-continue')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('rebuild-design-continue'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'keep-similar' }),
      'https://example.com',
    )
  })
})

describe('RebuildDesignModal toggles', () => {
  it('selecting Keep similar seeds all toggles on and submits an all-on choice', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={() => {}} onSelect={onSelect} />)
    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByTestId('rebuild-design-option-keep-similar'))
    fireEvent.click(screen.getByTestId('rebuild-design-continue'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'keep-similar', keepLogo: true, keepImages: true, keepColors: true, keepFonts: true }),
      expect.any(String),
    )
  })

  it('Reimagine then flipping Colors on submits a mixed choice', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={() => {}} onSelect={onSelect} />)
    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByTestId('rebuild-design-option-modernize'))
    fireEvent.click(screen.getByTestId('rebuild-bring-over-colors'))
    fireEvent.click(screen.getByTestId('rebuild-design-continue'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'modernize', keepColors: true, keepLogo: true }),
      expect.any(String),
    )
  })

  it('Reimagine preset: keepLogo on, all other toggles off', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={() => {}} onSelect={onSelect} />)
    fireEvent.change(screen.getByTestId('rebuild-design-url-input'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByTestId('rebuild-design-option-modernize'))
    fireEvent.click(screen.getByTestId('rebuild-design-continue'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'modernize',
        keepLogo: true,
        keepImages: false,
        keepColors: false,
        keepFonts: false,
      }),
      expect.any(String),
    )
  })
})
