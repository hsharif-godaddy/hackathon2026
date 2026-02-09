import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { SocialConnectionStatus, SocialConnectionStatusMessage } from './SocialConnectionStatusMessage'

describe('SocialConnectionStatusMessage', () => {
  it('renders success state with checkmark icon', () => {
    const { container } = renderWithProviders(
      <SocialConnectionStatusMessage
        status={SocialConnectionStatus.Success}
        platformName="Facebook"
      />
    )

    expect(screen.getByText('builder_social_connected_to_platform')).toBeInTheDocument()

    const box = container.querySelector('.border-intents-ux-success-borderColor')
    expect(box).toBeInTheDocument()
    expect(box).toHaveClass('bg-intents-ux-success-backgroundColor')
  })

  it('renders error state with alert icon', () => {
    const { container } = renderWithProviders(
      <SocialConnectionStatusMessage
        status={SocialConnectionStatus.Error}
        platformName="Instagram"
      />
    )

    expect(screen.getByText('builder_social_failed_to_connect_platform')).toBeInTheDocument()

    const box = container.querySelector('.border-intents-ux-error-borderColor')
    expect(box).toBeInTheDocument()
    expect(box).toHaveClass('bg-intents-ux-error-backgroundColor')
  })

  it('renders incomplete state with info icon', () => {
    const { container } = renderWithProviders(
      <SocialConnectionStatusMessage
        status={SocialConnectionStatus.Incomplete}
        platformName="Google Business Profile"
      />
    )

    expect(screen.getByText('builder_social_connection_incomplete_platform')).toBeInTheDocument()

    const box = container.querySelector('.border-intents-ux-info-borderColor')
    expect(box).toBeInTheDocument()
    expect(box).toHaveClass('bg-intents-ux-info-backgroundColor')
  })

  it('displays error message when provided', () => {
    renderWithProviders(
      <SocialConnectionStatusMessage
        status={SocialConnectionStatus.Error}
        platformName="Facebook"
        errorMessage="Missing permissions: manage_pages"
      />
    )

    expect(screen.getByText('Missing permissions: manage_pages')).toBeInTheDocument()
  })

  it('does not display error message for success state', () => {
    renderWithProviders(
      <SocialConnectionStatusMessage
        status={SocialConnectionStatus.Success}
        platformName="Facebook"
        errorMessage="This should not appear"
      />
    )

    expect(screen.queryByText('This should not appear')).not.toBeInTheDocument()
  })

  it('uses correct platform name in message', () => {
    renderWithProviders(
      <SocialConnectionStatusMessage
        status={SocialConnectionStatus.Success}
        platformName="Yelp"
      />
    )

    expect(screen.getByText('builder_social_connected_to_platform')).toBeInTheDocument()
  })
})
