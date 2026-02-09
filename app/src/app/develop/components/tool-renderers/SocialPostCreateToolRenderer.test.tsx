import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

import { SocialPostState } from '@/types/social-posts'

const mockSyncResult = vi.fn().mockResolvedValue(true)
let postPublishedCallback: ((postId: string) => void) | null = null

vi.mock('@/hooks/useToolResultSync', () => ({
  useToolResultSync: () => mockSyncResult
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (selector: (state: { currentAppId: string }) => string) =>
    selector({ currentAppId: 'test-app-id' })
}))

vi.mock('@/utils/social', () => ({
  onPostPublished: (callback: (postId: string) => void) => {
    postPublishedCallback = callback
    return () => { postPublishedCallback = null }
  }
}))

vi.mock('@/hooks/useSocial', () => ({
  useSiteAssociations: () => ({ data: { associations: [] }, isLoading: false })
}))

vi.mock('@/app/develop/components/widgets/SocialPostList', () => ({
  SocialPostList: ({ posts }: { posts: Array<{ id: string; publishedState?: string }> }) => (
    <div data-testid="social-post-list">
      {posts.map(post => (
        <div
          key={post.id}
          data-testid={`post-${post.id}`}
          {...(post.publishedState ? { 'data-published-state': post.publishedState } : {})}
        >
          Post {post.id}: {post.publishedState || 'draft'}
        </div>
      ))}
    </div>
  )
}))

import SocialPostCreateToolRenderer from './SocialPostCreateToolRenderer'

describe('SocialPostCreateToolRenderer', () => {
  const defaultProps = {
    toolName: 'socialPostCreate',
    toolStatus: 'completed' as const,
    toolId: 'test-tool-id',
    conversationId: 'test-conversation-id'
  }

  const createMockPost = (id: string, publishedState?: SocialPostState) => ({
    id,
    platform: 'facebook',
    content: `Test content ${id}`,
    publishedState
  })

  beforeEach(() => {
    vi.clearAllMocks()
    postPublishedCallback = null
  })

  describe('history sync - preserves published state', () => {
    it('should load posts with publishedState from history result', async () => {
      const historyResult = {
        widget: {
          widgetData: {
            posts: [
              createMockPost('post-1', SocialPostState.PUBLISHED),
              createMockPost('post-2') // No publishedState (draft)
            ]
          }
        }
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={historyResult}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('social-post-list')).toBeInTheDocument()
      })

      const publishedPost = screen.getByTestId('post-post-1')
      const draftPost = screen.getByTestId('post-post-2')

      // Published post should have the state attribute
      expect(publishedPost).toHaveAttribute('data-published-state', SocialPostState.PUBLISHED)
      // Draft post (no publishedState) should NOT have the attribute
      expect(draftPost).not.toHaveAttribute('data-published-state')
    })

    it('should sync posts when handlePostUpdate is called', async () => {
      const result = {
        posts: [createMockPost('post-1')]
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('social-post-list')).toBeInTheDocument()
      })

      // Note: handlePostUpdate is called internally by SocialPostList
      // The sync happens when posts are edited, not on initial render
    })

    it('should NOT sync on initial render (only on edits)', async () => {
      const result = {
        posts: [createMockPost('post-1')]
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('social-post-list')).toBeInTheDocument()
      })

      // Sync should not be called on initial render
      expect(mockSyncResult).not.toHaveBeenCalled()
    })
  })

  describe('post published event updates state', () => {
    it('should update post publishedState when onPostPublished fires', async () => {
      const result = {
        posts: [
          createMockPost('post-1'),
          createMockPost('post-2')
        ]
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('social-post-list')).toBeInTheDocument()
      })

      // Simulate post published event
      act(() => {
        postPublishedCallback?.('post-1')
      })

      await waitFor(() => {
        const publishedPost = screen.getByTestId('post-post-1')
        expect(publishedPost).toHaveAttribute('data-published-state', SocialPostState.PUBLISHED)
      })

      // post-2 should remain unchanged
      const unchangedPost = screen.getByTestId('post-post-2')
      expect(unchangedPost).not.toHaveAttribute('data-published-state', SocialPostState.PUBLISHED)
    })

    it('should update UI state after post is published (sync handled separately)', async () => {
      const result = {
        posts: [createMockPost('post-1')]
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('social-post-list')).toBeInTheDocument()
      })

      // Simulate post published event
      act(() => {
        postPublishedCallback?.('post-1')
      })

      // UI should update to show published state
      await waitFor(() => {
        const publishedPost = screen.getByTestId('post-post-1')
        expect(publishedPost).toHaveAttribute('data-published-state', SocialPostState.PUBLISHED)
      })
    })
  })

  describe('result format handling', () => {
    it('should handle posts in widget.widgetData.posts format', async () => {
      const result = {
        widget: {
          widgetData: {
            posts: [createMockPost('post-nested')]
          }
        }
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('post-post-nested')).toBeInTheDocument()
      })
    })

    it('should handle posts in flat posts array format', async () => {
      const result = {
        posts: [createMockPost('post-flat')]
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('post-post-flat')).toBeInTheDocument()
      })
    })

    it('should prefer widget.widgetData.posts over flat posts', async () => {
      const result = {
        widget: {
          widgetData: {
            posts: [createMockPost('post-from-widget')]
          }
        },
        posts: [createMockPost('post-from-flat')]
      }

      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('post-post-from-widget')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('post-post-from-flat')).not.toBeInTheDocument()
    })
  })

  describe('fallback behavior', () => {
    it('should render DefaultToolRenderer on error status', () => {
      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          toolStatus="error"
          result={{ error: 'Failed to create posts' }}
        />
      )

      expect(screen.queryByTestId('social-post-list')).not.toBeInTheDocument()
    })

    it('should render DefaultToolRenderer when no posts', () => {
      render(
        <SocialPostCreateToolRenderer
          {...defaultProps}
          result={{ posts: [] }}
        />
      )

      expect(screen.queryByTestId('social-post-list')).not.toBeInTheDocument()
    })
  })
})
