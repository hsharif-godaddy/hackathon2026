/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { GOOGLE_REVIEWS_READY } from '@/types/social'
import GoogleReviewsToolRenderer from './GoogleReviewsToolRenderer'

// --- mocks ---

const mockSendMessage = vi.fn()
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({ sendMessage: mockSendMessage }),
}))

const mockGetConnectionById = vi.fn()
const mockGetGoogleLocations = vi.fn()
const mockGetGoogleReviews = vi.fn()
vi.mock('@/lib/social', () => ({
  socialV2Client: {
    getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
    getGoogleLocations: (...args: unknown[]) => mockGetGoogleLocations(...args),
    getGoogleReviews: (...args: unknown[]) => mockGetGoogleReviews(...args),
  },
}))

const mockIsGoogleConnection = vi.fn(function () { return true; })
vi.mock('@/lib/utils/social-type-guards', () => ({
  isGoogleConnection: (...args: unknown[]) => mockIsGoogleConnection(...args),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/[market]/develop/components/tool-renderers/ToolHeader', () => ({
  default: () => <div data-testid="tool-header" />,
}))

vi.mock('@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer', () => ({
  default: () => <div data-testid="default-tool-renderer" />,
}))

// --- fixtures ---

const SOCIAL_ID = 'conn-abc123'

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'GOOGLE_BUSINESS_PROFILE',
    userTokenId: 'tok-user-123',
    locationId: 'loc-999',
    accountId: 'acc-777',
    userId: 'user-123',
    ...overrides,
  }
}

function renderRenderer(props: Record<string, unknown> = {}) {
  return render(
    <GoogleReviewsToolRenderer
      toolName="google_reviews"
      toolStatus="completed"
      toolId="tool-1"
      conversationId="conv-1"
      result={{ action: 'fetchReviews', socialId: SOCIAL_ID }}
      isLastAssistantMessage={true}
      {...props}
    />
  )
}

// --- tests ---

describe('GoogleReviewsToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsGoogleConnection.mockReturnValue(true)
    mockGetConnectionById.mockResolvedValue(makeConnection())
    mockGetGoogleReviews.mockResolvedValue([])
  })

  it('shows loading state before fetch completes', () => {
    mockGetConnectionById.mockImplementation(function () { return new Promise(() => {}); })

    renderRenderer()

    expect(screen.getByText(/Loading your Google reviews/)).toBeInTheDocument()
  })

  it('shows "Reviews loaded." after successful fetch', async () => {
    renderRenderer()

    await waitFor(() => {
      expect(screen.getByText('Reviews loaded.')).toBeInTheDocument()
    })
  })

  it('sends GOOGLE_REVIEWS_READY with the reviews on success', async () => {
    const reviews = [{ reviewId: 'r1' }, { reviewId: 'r2' }]
    mockGetGoogleReviews.mockResolvedValue(reviews)

    renderRenderer()

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customContext: { type: GOOGLE_REVIEWS_READY, data: { reviews } },
        })
      )
    })
  })

  it('calls getGoogleReviews with accountId from the stored connection', async () => {
    mockGetConnectionById.mockResolvedValue(
      makeConnection({ accountId: 'acc-specific', locationId: 'loc-specific', userTokenId: 'tok-specific' })
    )

    renderRenderer()

    await waitFor(() => {
      expect(mockGetGoogleReviews).toHaveBeenCalledWith('tok-specific', 'acc-specific', 'loc-specific')
    })
  })

  describe('soft fallback for connections missing accountId', () => {
    it('calls getGoogleLocations when accountId is absent', async () => {
      mockGetConnectionById.mockResolvedValue(makeConnection({ accountId: undefined }))
      mockGetGoogleLocations.mockResolvedValue([
        { id: 'loc-999', accountId: 'acc-from-lookup', name: 'locations/999', title: 'My Store' },
      ])

      renderRenderer()

      await waitFor(() => {
        expect(mockGetGoogleLocations).toHaveBeenCalledWith('tok-user-123')
      })
    })

    it('uses the looked-up accountId to fetch reviews', async () => {
      mockGetConnectionById.mockResolvedValue(makeConnection({ accountId: undefined }))
      mockGetGoogleLocations.mockResolvedValue([
        { id: 'loc-999', accountId: 'acc-from-lookup', name: 'locations/999', title: 'My Store' },
      ])

      renderRenderer()

      await waitFor(() => {
        expect(mockGetGoogleReviews).toHaveBeenCalledWith('tok-user-123', 'acc-from-lookup', 'loc-999')
      })
    })

    it('shows error when fallback lookup finds no matching location', async () => {
      mockGetConnectionById.mockResolvedValue(makeConnection({ accountId: undefined }))
      mockGetGoogleLocations.mockResolvedValue([
        { id: 'different-loc', accountId: 'acc-other', name: 'locations/other', title: 'Other' },
      ])

      renderRenderer()

      await waitFor(() => {
        expect(screen.getByText(/missing account info/)).toBeInTheDocument()
      })
    })
  })

  it('shows error message when getGoogleReviews throws', async () => {
    mockGetGoogleReviews.mockRejectedValue(new Error('Failed to fetch Google reviews: 401'))

    renderRenderer()

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch Google reviews: 401')).toBeInTheDocument()
    })
  })

  it('does not fetch when isLastAssistantMessage is false', () => {
    renderRenderer({ isLastAssistantMessage: false })

    expect(mockGetConnectionById).not.toHaveBeenCalled()
  })

  it('renders DefaultToolRenderer when action is not fetchReviews', () => {
    renderRenderer({ result: { action: 'other', socialId: SOCIAL_ID } })

    expect(screen.getByTestId('default-tool-renderer')).toBeInTheDocument()
  })

  describe('tool name compatibility', () => {
    it('works with legacy global tool name "googleReviews"', async () => {
      render(
        <GoogleReviewsToolRenderer
          toolName="googleReviews"
          toolStatus="completed"
          toolId="tool-1"
          conversationId="conv-1"
          result={{ action: 'fetchReviews', socialId: SOCIAL_ID }}
          isLastAssistantMessage={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Reviews loaded.')).toBeInTheDocument()
      })
    })

    it('works with new skill-specific tool name "google-reviews__fetchReviews"', async () => {
      render(
        <GoogleReviewsToolRenderer
          toolName="google-reviews__fetchReviews"
          toolStatus="completed"
          toolId="tool-1"
          conversationId="conv-1"
          result={{ action: 'fetchReviews', socialId: SOCIAL_ID }}
          isLastAssistantMessage={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Reviews loaded.')).toBeInTheDocument()
      })
    })
  })
})
