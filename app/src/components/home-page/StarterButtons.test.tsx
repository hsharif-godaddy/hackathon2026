/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { StarterButtons } from './StarterButtons'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _params: unknown, defaultMsg?: string) => defaultMsg ?? key,
}))

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (eid: string) => eid,
  logClickEvent: () => () => {},
}))

describe('StarterButtons', function starterButtonsTests() {
  it('renders all five category buttons', function rendersAll() {
    renderWithProviders(<StarterButtons selected={null} onSelect={() => {}} />)

    expect(screen.getByTestId('starter-button-new_website')).toBeInTheDocument()
    expect(screen.getByTestId('starter-button-rebuild_site')).toBeInTheDocument()
    expect(screen.getByTestId('starter-button-app')).toBeInTheDocument()
    expect(screen.getByTestId('starter-button-logo')).toBeInTheDocument()
    expect(screen.getByTestId('starter-button-something_else')).toBeInTheDocument()
  })

  it('renders the English default labels', function rendersLabels() {
    renderWithProviders(<StarterButtons selected={null} onSelect={() => {}} />)

    expect(screen.getByText('New Website')).toBeInTheDocument()
    expect(screen.getByText('Rebuild Site')).toBeInTheDocument()
    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.getByText('Logo')).toBeInTheDocument()
    expect(screen.getByText('Something Else')).toBeInTheDocument()
  })

  it('marks only the selected category as pressed', function marksSelected() {
    renderWithProviders(<StarterButtons selected="logo" onSelect={() => {}} />)

    expect(screen.getByTestId('starter-button-logo')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('starter-button-app')).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks none as pressed when selection is null', function noneSelected() {
    renderWithProviders(<StarterButtons selected={null} onSelect={() => {}} />)

    expect(screen.getByTestId('starter-button-new_website')).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onSelect with the category id when a button is clicked', function fishesOnSelect() {
    const onSelect = vi.fn()
    renderWithProviders(<StarterButtons selected={null} onSelect={onSelect} />)

    fireEvent.click(screen.getByTestId('starter-button-rebuild_site'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('rebuild_site')
  })
})
