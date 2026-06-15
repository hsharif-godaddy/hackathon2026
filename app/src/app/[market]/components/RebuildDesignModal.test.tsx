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

vi.mock('@ux/text', () => ({
  default: {
    span: ({ children, ...props }: React.ComponentProps<'span'>) => <span {...props}>{children}</span>,
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
  },
}))

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

  it('disables Continue until a direction is selected, then fires onSelect with it', () => {
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
    expect(onSelect).toHaveBeenCalledWith('modernize', 'https://example.com')
    expect(mockTrackChoice).toHaveBeenCalledWith('modernize')
  })

  it('passes an empty url when the input is blank', () => {
    const onSelect = vi.fn()
    render(<RebuildDesignModal open onClose={vi.fn()} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('rebuild-design-option-keep-similar'))
    fireEvent.click(screen.getByTestId('rebuild-design-continue'))

    expect(onSelect).toHaveBeenCalledWith('keep-similar', '')
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
    expect(onSelect).toHaveBeenCalledWith('keep-similar', 'https://example.com')
  })
})
