/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => <>{children}</>,
  motion: {
    div: ({ children, className, ...rest }: React.ComponentProps<'div'>) => (
      <div className={className} {...rest}>
        {children}
      </div>
    ),
  },
}))
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CollapsibleChatInputSection from './CollapsibleChatInputSection'

describe('CollapsibleChatInputSection', () => {
  it('button is accessible by section title via aria-labelledby', () => {
    render(
      <CollapsibleChatInputSection title="Up next" defaultExpanded>
        <div>Panel body</div>
      </CollapsibleChatInputSection>
    )

    expect(screen.getByRole('button', { name: 'Up next' })).toBeInTheDocument()
  })

  it('toggles aria-expanded when the chevron button is clicked (uncontrolled)', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleChatInputSection title="Up next" defaultExpanded>
        <div>Panel body</div>
      </CollapsibleChatInputSection>
    )

    const toggle = screen.getByRole('button', { expanded: true })
    expect(screen.getByText('Panel body')).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Panel body')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Panel body')).toBeInTheDocument()
  })

  it('renders footer inside the expanded region with space-between layout', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleChatInputSection
        title="Choose"
        defaultExpanded={false}
        footer={
          <div data-testid="footer-row">
            <span>Left</span>
            <span>Right</span>
          </div>
        }
      >
        <div>Body</div>
      </CollapsibleChatInputSection>
    )

    expect(screen.queryByText('Body')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Body')).toBeInTheDocument()
    const footer = screen.getByTestId('footer-row')
    expect(within(footer).getByText('Left')).toBeInTheDocument()
    expect(within(footer).getByText('Right')).toBeInTheDocument()
  })

  it('calls onExpandedChange when controlled', async () => {
    const user = userEvent.setup()
    const onExpandedChange = vi.fn()
    const { rerender } = render(
      <CollapsibleChatInputSection title="T" expanded onExpandedChange={onExpandedChange}>
        <div>B</div>
      </CollapsibleChatInputSection>
    )

    await user.click(screen.getByRole('button', { expanded: true }))
    expect(onExpandedChange).toHaveBeenCalledWith(false)

    rerender(
      <CollapsibleChatInputSection title="T" expanded={false} onExpandedChange={onExpandedChange}>
        <div>B</div>
      </CollapsibleChatInputSection>
    )
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  describe('dismiss (X) instead of collapse chevron', () => {
    it('renders a dismiss button (no collapse toggle) when onDismiss is set', () => {
      render(
        <CollapsibleChatInputSection title="What do you think?" onDismiss={vi.fn()} dismissLabel="Dismiss">
          <div>Body</div>
        </CollapsibleChatInputSection>
      )
      // Dismiss button present; the collapse toggle (aria-expanded) is gone.
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument()
    })

    it('calls onDismiss when the X is clicked', async () => {
      const user = userEvent.setup()
      const onDismiss = vi.fn()
      render(
        <CollapsibleChatInputSection title="T" onDismiss={onDismiss} dismissLabel="Dismiss">
          <div>Body</div>
        </CollapsibleChatInputSection>
      )
      await user.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })
  })
})
