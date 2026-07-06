/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
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

describe('SocialPostCanvasPane', () => {
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
        post={{
          id: 'post-1',
          styleLabel: 'Social Post',
          content: 'Post content',
          hashtags: [],
          images: [{ url: 'https://cdn.example/post.png', width: 1024, height: 1024 }],
        }}
        appId="app-1"
        onBack={onBack}
      />,
    )

    const scheduleButton = screen.getByRole('button', { name: 'Schedule' })
    expect(scheduleButton).toBeEnabled()
    await user.click(scheduleButton)

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
})
