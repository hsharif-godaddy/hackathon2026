/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import Growl from '@ux/growl'

import { SocialPostCanvasPane } from '@/app/[market]/develop/components/settings/Campaigns/SocialPostCanvasPane'
import { renderWithProviders } from '@/tests/test-utils'

const mockSendMessage = vi.fn()

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: mockSendMessage,
  }),
}))

vi.mock('@/hooks/useSocial', () => ({
  useSiteAssociations: () => ({
    data: {
      associations: [
        { id: 'assoc-facebook', appId: 'app-1', socialId: 'facebook-id', platform: 'facebook', createdAt: '2024-01-01' },
        { id: 'assoc-instagram', appId: 'app-1', socialId: 'instagram-id', platform: 'instagram', createdAt: '2024-01-01' },
      ],
    },
  }),
}))

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}))

vi.mock('@ux/modal', () => ({
  default: ({
    title,
    children,
    onClose,
  }: {
    title: string
    children: ReactNode
    onClose: () => void
  }) => (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={onClose}>Close</button>
      {children}
    </div>
  ),
}))

vi.mock('@ux/date-input', () => ({
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: string[]
    onChange: (nextValue: string[]) => void
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value[0] || ''}
        onChange={(event) => onChange([event.target.value])}
      />
    </label>
  ),
}))

vi.mock('@ux/time-picker', () => ({
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: string
    onChange: (nextValue: string) => void
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}))

describe('SocialPostCanvasPane', () => {
  const standalonePost = {
    id: 'post-1',
    styleLabel: 'Social Post',
    content: 'Post content',
    hashtags: [],
    images: [{ url: 'https://cdn.example/post.png', width: 1024, height: 1024 }],
  }

  const campaignPost = {
    ...standalonePost,
    campaignId: 'campaign-1',
    campaignContentId: 'content-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates preview content when post prop changes', () => {
    const { rerender } = renderWithProviders(
      <SocialPostCanvasPane
        post={{
          id: 'post-1',
          styleLabel: 'Social Post',
          content: 'Original social copy',
          hashtags: [],
          images: [{ url: 'https://cdn.example/post.png', width: 1024, height: 1024 }],
        }}
        appId="app-1"
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Original social copy')).toBeInTheDocument()

    rerender(
      <SocialPostCanvasPane
        post={{
          id: 'post-1',
          styleLabel: 'Social Post',
          content: 'Updated social copy',
          hashtags: [],
          images: [{ url: 'https://cdn.example/post.png', width: 1024, height: 1024 }],
        }}
        appId="app-1"
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Updated social copy')).toBeInTheDocument()
  })

  it('shows an error growl when publish fails', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('publish failed'))
    const onBack = vi.fn()

    const { user } = renderWithProviders(
      <SocialPostCanvasPane
        post={campaignPost}
        appId="app-1"
        onBack={onBack}
      />,
    )

    const scheduleButton = screen.getByRole('button', { name: 'builder_social_schedule_title' })
    expect(scheduleButton).toBeEnabled()
    await user.click(scheduleButton)
    await user.click(screen.getByRole('button', { name: /Publish now|builder_social_schedule_now/ }))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'social-post-publish-failed',
          emphasis: 'critical',
        }),
      )
    })
    expect(onBack).not.toHaveBeenCalled()
  })

  it('hides schedule CTA for standalone posts', () => {
    renderWithProviders(
      <SocialPostCanvasPane
        post={standalonePost}
        appId="app-1"
        onBack={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'builder_social_schedule_title' })).not.toBeInTheDocument()
  })

  it('shows schedule CTA for campaign posts', () => {
    renderWithProviders(
      <SocialPostCanvasPane
        post={campaignPost}
        appId="app-1"
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'builder_social_schedule_title' })).toBeInTheDocument()
  })

  it('shows facebook and instagram preview tabs for standalone posts', async () => {
    const { user } = renderWithProviders(
      <SocialPostCanvasPane
        post={standalonePost}
        appId="app-1"
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'builder_social_platform_all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'builder_social_platform_facebook' })).toBeInTheDocument()
    const instagramTab = screen.getByRole('button', { name: 'builder_social_platform_instagram' })
    expect(instagramTab).toBeInTheDocument()

    await user.click(instagramTab)

    expect(instagramTab.className).toContain('border-intents-ux-box-borderColor')
  })

  it('defaults scheduling payload to Facebook only', async () => {
    const { user } = renderWithProviders(
      <SocialPostCanvasPane
        post={campaignPost}
        appId="app-1"
        onBack={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'builder_social_schedule_title' }))
    const scheduleButtons = screen.getAllByRole('button', { name: 'builder_social_schedule_title' })
    await user.click(scheduleButtons[scheduleButtons.length - 1])

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Schedule'),
        customContext: expect.objectContaining({
          data: expect.objectContaining({
            platforms: ['facebook'],
            pendingPublish: expect.objectContaining({
              scheduledAt: expect.any(Date),
            }),
          }),
        }),
      }))
    })
  })
})
