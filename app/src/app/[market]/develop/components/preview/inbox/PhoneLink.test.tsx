// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { PhoneLink } from './PhoneLink'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('PhoneLink menu', () => {
  // The @ux/menu CLOSE_MENU action calls focus(triggerRef.current) on every
  // close (outside click, escape, select). If the trigger is not focusable the
  // menu's focus state is left stranded, which breaks reopening after an
  // outside-click close.
  it('restores focus to the trigger when the menu closes', () => {
    render(<PhoneLink phone='+14805551234' />)
    const trigger = screen.getByText('(480) 555-1234')

    fireEvent.mouseDown(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  // role="button" carries an ARIA contract that Enter/Space activate the control. The
  // trigger is a <span>, so this is not free from the browser — pin that @ux/menu wires it.
  it.each(['Enter', ' '])('opens the menu when the trigger receives %s', (key) => {
    render(<PhoneLink phone='+14805551234' />)
    const trigger = screen.getByText('(480) 555-1234')

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(trigger, { key })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })
})
