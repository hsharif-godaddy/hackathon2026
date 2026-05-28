/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { FacebookPage, GoogleLocation } from '@/lib/social'
import { SocialPageSelector } from './SocialPageSelector'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    if (key === 'builder_social_select_platform_page') {
      return `Select a ${vars?.platformDisplayName} page`
    }
    if (key === 'builder_social_no_pages_found') {
      return `No ${vars?.platformDisplayName} pages found`
    }
    if (key === 'builder_social_connect_selected_page') {
      return 'Connect Selected Page'
    }
    if (key === 'builder_common_cancel') {
      return 'Cancel'
    }
    return key
  }
}))

vi.mock('@/lib/social-platforms', () => ({
  PLATFORM_CONFIG: {
    facebook: { name: 'Facebook' },
    instagram: { name: 'Instagram' },
    google: { name: 'Google' }
  }
}))

describe('SocialPageSelector', () => {
  const mockOnSelect = vi.fn()
  const mockOnCancel = vi.fn()

  it('renders with Facebook pages', () => {
    const pages: FacebookPage[] = [
      {
        id: '123',
        name: 'My Business',
        category: 'Local Business'
      }
    ]

    render(
      <SocialPageSelector
        platform="facebook"
        pages={pages}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByText('My Business')).toBeInTheDocument()
    expect(screen.getByText('Local Business')).toBeInTheDocument()
    expect(screen.getByText('Connect Selected Page')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('renders with Google locations', () => {
    const locations: GoogleLocation[] = [
      {
        id: 'loc123',
        accountId: 'acc123',
        name: 'locations/123',
        title: 'My Store',
        storefrontAddress: {
          locality: 'San Francisco',
          administrativeArea: 'CA'
        }
      }
    ]

    render(
      <SocialPageSelector
        platform="google"
        pages={locations}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByText('My Store')).toBeInTheDocument()
    expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()
    expect(screen.getByText('Connect Selected Page')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('renders empty state when no pages available', () => {
    render(
      <SocialPageSelector
        platform="facebook"
        pages={[]}
        onSelect={mockOnSelect}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByText('No Facebook pages found')).toBeInTheDocument()
  })
})
