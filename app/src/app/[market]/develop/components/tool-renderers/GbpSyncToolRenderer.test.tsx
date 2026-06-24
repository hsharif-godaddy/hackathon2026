/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { GBP_PROFILE_READY, GBP_UPDATE_DONE } from '@/types/social'
import GbpSyncToolRenderer from './GbpSyncToolRenderer'

// --- mocks ---

const mockSendMessage = vi.fn()
vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({ sendMessage: mockSendMessage }),
}))

const mockGetConnectionById = vi.fn()
const mockGetGoogleBusinessProfile = vi.fn()
const mockUpdateGoogleBusinessProfile = vi.fn()
vi.mock('@/lib/social', () => ({
  socialV2Client: {
    getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
    getGoogleBusinessProfile: (...args: unknown[]) => mockGetGoogleBusinessProfile(...args),
    updateGoogleBusinessProfile: (...args: unknown[]) => mockUpdateGoogleBusinessProfile(...args),
  },
}))

const mockIsGoogleConnection = vi.fn(function () { return true; })
vi.mock('@/lib/utils/social-type-guards', () => ({
  isGoogleConnection: (...args: unknown[]) => mockIsGoogleConnection(...args),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

// No IntlProvider in the test tree — return the supplied defaultMessage so rendered text is stable.
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string, _values?: Record<string, unknown>, defaultMessage?: string) => defaultMessage ?? id,
}))

vi.mock('@/app/[market]/develop/components/tool-renderers/ToolHeader', () => ({
  default: () => <div data-testid="tool-header" />,
}))

vi.mock('@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer', () => ({
  default: () => <div data-testid="default-tool-renderer" />,
}))

// --- fixtures ---

const SOCIAL_ID = 'conn-abc123'

const SAMPLE_PROFILE = {
  name: 'Acme Plumbing',
  primaryPhone: '(555) 123-4567',
  websiteUri: 'https://acme-plumbing.com',
}

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
    <GbpSyncToolRenderer
      toolName="google-business-profile-sync__getGbpProfile"
      toolStatus="completed"
      toolId="tool-1"
      conversationId="conv-1"
      result={{ action: 'getGbpProfile', socialId: SOCIAL_ID }}
      isLastAssistantMessage={true}
      {...props}
    />
  )
}

// --- tests ---

describe('GbpSyncToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsGoogleConnection.mockReturnValue(true)
    mockGetConnectionById.mockResolvedValue(makeConnection())
    mockGetGoogleBusinessProfile.mockResolvedValue(SAMPLE_PROFILE)
    mockUpdateGoogleBusinessProfile.mockResolvedValue({ updated: ['primaryPhone'] })
  })

  it('shows loading state before the read completes', () => {
    mockGetConnectionById.mockImplementation(function () { return new Promise(() => {}); })

    renderRenderer()

    expect(screen.getByText(/Reading your Google Business Profile listing/)).toBeInTheDocument()
  })

  it('shows "Listing loaded." after a successful read', async () => {
    renderRenderer()

    await waitFor(() => {
      expect(screen.getByText('Listing loaded.')).toBeInTheDocument()
    })
  })

  it('sends GBP_PROFILE_READY with the profile on success', async () => {
    renderRenderer()

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customContext: { type: GBP_PROFILE_READY, data: { profile: SAMPLE_PROFILE } },
        })
      )
    })
  })

  it('calls getGoogleBusinessProfile with userTokenId and locationId from the connection', async () => {
    mockGetConnectionById.mockResolvedValue(
      makeConnection({ locationId: 'loc-specific', userTokenId: 'tok-specific' })
    )

    renderRenderer()

    await waitFor(() => {
      expect(mockGetGoogleBusinessProfile).toHaveBeenCalledWith('tok-specific', 'loc-specific')
    })
  })

  it('shows an error when the connection is missing a location', async () => {
    mockGetConnectionById.mockResolvedValue(makeConnection({ locationId: undefined }))

    renderRenderer()

    await waitFor(() => {
      expect(screen.getByText(/missing a location/)).toBeInTheDocument()
    })
    expect(mockGetGoogleBusinessProfile).not.toHaveBeenCalled()
  })

  it('shows an error message when getGoogleBusinessProfile throws', async () => {
    mockGetGoogleBusinessProfile.mockRejectedValue(new Error('Failed to fetch Google Business Profile: 401'))

    renderRenderer()

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch Google Business Profile: 401')).toBeInTheDocument()
    })
  })

  it('posts GBP_PROFILE_READY with an error on read failure so the agent pass-2 does not stall', async () => {
    mockGetGoogleBusinessProfile.mockRejectedValue(new Error('Failed to fetch Google Business Profile: 401'))

    renderRenderer()

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customContext: { type: GBP_PROFILE_READY, data: { error: 'Failed to fetch Google Business Profile: 401' } },
        })
      )
    })
  })

  it('does not read when isLastAssistantMessage is false', () => {
    renderRenderer({ isLastAssistantMessage: false })

    expect(mockGetConnectionById).not.toHaveBeenCalled()
  })

  it('renders DefaultToolRenderer when action is not a GBP action', () => {
    renderRenderer({ result: { action: 'other', socialId: SOCIAL_ID } })

    expect(screen.getByTestId('default-tool-renderer')).toBeInTheDocument()
  })

  describe('updateGbp action', () => {
    function renderUpdate(props: Record<string, unknown> = {}) {
      return render(
        <GbpSyncToolRenderer
          toolName="google-business-profile-sync__syncField"
          toolStatus="completed"
          toolId="tool-2"
          conversationId="conv-1"
          result={{ action: 'updateGbp', socialId: SOCIAL_ID, field: 'phone', updates: { primaryPhone: '(555) 123-9999' } }}
          isLastAssistantMessage={true}
          {...props}
        />
      )
    }

    it('calls updateGoogleBusinessProfile with the updates from the signal', async () => {
      renderUpdate()

      await waitFor(() => {
        expect(mockUpdateGoogleBusinessProfile).toHaveBeenCalledWith('tok-user-123', 'loc-999', { primaryPhone: '(555) 123-9999' })
      })
    })

    it('posts GBP_UPDATE_DONE with field + updated on success', async () => {
      renderUpdate()

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            customContext: { type: GBP_UPDATE_DONE, data: { field: 'phone', updated: ['primaryPhone'] } },
          })
        )
      })
      expect(screen.getByText('Listing updated.')).toBeInTheDocument()
    })

    it('posts GBP_UPDATE_DONE with an error when the update fails', async () => {
      mockUpdateGoogleBusinessProfile.mockRejectedValue(new Error('Failed to update Google Business Profile: 403'))

      renderUpdate()

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            customContext: { type: GBP_UPDATE_DONE, data: { field: 'phone', updated: [], error: 'Failed to update Google Business Profile: 403' } },
          })
        )
      })
      expect(screen.getByText(/Failed to update Google Business Profile: 403/)).toBeInTheDocument()
    })

    it('shows the updating label while in flight', () => {
      mockGetConnectionById.mockImplementation(function () { return new Promise(() => {}); })

      renderUpdate()

      expect(screen.getByText(/Updating your Google Business Profile/)).toBeInTheDocument()
    })
  })
})
