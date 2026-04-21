/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { SocialPublishStatus, SocialPublishStatusMessage } from './SocialPublishStatusMessage'

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => id
}))

describe('SocialPublishStatusMessage', () => {
  it('renders success state with View Post button', () => {
    const { container } = renderWithProviders(
      <SocialPublishStatusMessage
        status={SocialPublishStatus.Success}
        platformName="Facebook"
        platformUrl="https://facebook.com/post/123"
      />
    )

    expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
    expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()

    const button = screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_post' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('href', 'https://facebook.com/post/123')
    expect(button).toHaveAttribute('target', '_blank')
    expect(button).toHaveAttribute('rel', 'noopener noreferrer')

    const box = container.querySelector('.border-intents-ux-success-borderColor')
    expect(box).toBeInTheDocument()
    expect(box).toHaveClass('bg-intents-ux-success-backgroundColor')
  })

  it('renders success state without button when no platformUrl', () => {
    renderWithProviders(
      <SocialPublishStatusMessage
        status={SocialPublishStatus.Success}
        platformName="Instagram"
      />
    )

    expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
    expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).not.toBeInTheDocument()
  })

  it('renders error state with error message', () => {
    const { container } = renderWithProviders(
      <SocialPublishStatusMessage
        status={SocialPublishStatus.Error}
        platformName="Twitter"
        errorMessage="Invalid access token"
      />
    )

    expect(screen.getByText('builder_widgets_socialpublish_failed')).toBeInTheDocument()
    expect(screen.getByText('Invalid access token')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).not.toBeInTheDocument()

    const box = container.querySelector('.border-intents-ux-error-borderColor')
    expect(box).toBeInTheDocument()
    expect(box).toHaveClass('bg-intents-ux-error-backgroundColor')
  })

  it('renders error state without error message', () => {
    renderWithProviders(
      <SocialPublishStatusMessage
        status={SocialPublishStatus.Error}
        platformName="Facebook"
      />
    )

    expect(screen.getByText('builder_widgets_socialpublish_failed')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).not.toBeInTheDocument()
  })


  it('uses correct platform name in messages', () => {
    renderWithProviders(
      <SocialPublishStatusMessage
        status={SocialPublishStatus.Success}
        platformName="LinkedIn"
        platformUrl="https://linkedin.com/post/123"
      />
    )

    expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()
  })

  it('button has correct data-eid attribute', () => {
    renderWithProviders(
      <SocialPublishStatusMessage
        status={SocialPublishStatus.Success}
        platformName="Facebook"
        platformUrl="https://facebook.com/post/123"
      />
    )

    const button = screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_post' })
    expect(button).toHaveAttribute('data-eid', 'social.publish.view_post_history')
  })
})
