/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import type { SiteAssociation } from '@/types/social'
import { PlatformSelector, type PlatformValidation } from './PlatformSelector'

const defaultValidation: Record<string, PlatformValidation> = {
  facebook: { valid: true, charCount: 100, maxChars: 63206, errors: [] },
  instagram: { valid: true, charCount: 100, maxChars: 2200, errors: [] }
}

const mockAssociations: SiteAssociation[] = [
  { id: '1', platform: 'Facebook', socialId: 'fb-123' } as SiteAssociation,
  { id: '2', platform: 'Instagram', socialId: 'ig-456' } as SiteAssociation
]

describe('PlatformSelector', () => {
  const defaultProps = {
    selectedPlatforms: new Set(['facebook', 'instagram'] as const),
    onPlatformToggle: vi.fn(),
    validation: defaultValidation
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "Ready" when associations prop is undefined (backwards compat)', () => {
    renderWithProviders(<PlatformSelector {...defaultProps} />)
    const readyElements = screen.getAllByText('builder_social_platform_ready')
    expect(readyElements).toHaveLength(2)
  })

  it('shows "Ready" when platforms are connected', () => {
    renderWithProviders(
      <PlatformSelector {...defaultProps} associations={mockAssociations} />
    )
    const readyElements = screen.getAllByText('builder_social_platform_ready')
    expect(readyElements).toHaveLength(2)
  })

  it('shows "Not Connected" when associations is empty array', () => {
    renderWithProviders(
      <PlatformSelector {...defaultProps} associations={[]} />
    )
    const notConnected = screen.getAllByText('builder_social_status_not_connected')
    expect(notConnected).toHaveLength(2)
    expect(screen.queryByText('builder_social_platform_ready')).not.toBeInTheDocument()
  })

  it('shows mixed status when only one platform connected', () => {
    const fbOnly: SiteAssociation[] = [
      { id: '1', platform: 'Facebook', socialId: 'fb-123' } as SiteAssociation
    ]
    renderWithProviders(
      <PlatformSelector {...defaultProps} associations={fbOnly} />
    )
    expect(screen.getByText('builder_social_platform_ready')).toBeInTheDocument()
    expect(screen.getByText('builder_social_status_not_connected')).toBeInTheDocument()
  })

  it('hides validation errors for unconnected platforms', () => {
    const invalidValidation: Record<string, PlatformValidation> = {
      facebook: { valid: false, charCount: 70000, maxChars: 63206, errors: ['Over limit'] },
      instagram: { valid: false, charCount: 3000, maxChars: 2200, errors: ['Over limit'] }
    }
    renderWithProviders(
      <PlatformSelector
        {...defaultProps}
        validation={invalidValidation}
        associations={[]}
      />
    )
    expect(screen.queryByText('Over limit')).not.toBeInTheDocument()
  })

  it('hides status text while associations are loading', () => {
    renderWithProviders(
      <PlatformSelector
        {...defaultProps}
        associations={undefined}
        isAssociationsUnavailable={true}
      />
    )
    expect(screen.queryByText('builder_social_platform_ready')).not.toBeInTheDocument()
    expect(screen.queryByText('builder_social_status_not_connected')).not.toBeInTheDocument()
  })

  it('shows status text after loading completes', () => {
    renderWithProviders(
      <PlatformSelector
        {...defaultProps}
        associations={mockAssociations}
        isAssociationsUnavailable={false}
      />
    )
    const readyElements = screen.getAllByText('builder_social_platform_ready')
    expect(readyElements).toHaveLength(2)
  })
})
