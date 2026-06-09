/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ market: 'en-US' }),
}))

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}))

const mockLinkMutateAsync = vi.fn()
vi.mock('@/hooks/social/mutations/useLinkConnection', () => ({
  useLinkConnection: () => ({
    mutateAsync: mockLinkMutateAsync,
  }),
}))

const mockUnlinkMutateAsync = vi.fn()
vi.mock('@/hooks/social/mutations/useUnlinkConnection', () => ({
  useUnlinkConnection: () => ({
    mutateAsync: mockUnlinkMutateAsync,
  }),
}))

const mockAssociationsData = { associations: [] as Array<{ id: string; platform: string; socialId: string }> }
vi.mock('@/hooks/useSocial', () => ({
  useSiteAssociations: () => ({
    data: mockAssociationsData,
  }),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (values) {
      return Object.entries(values).reduce(
        (msg, [k, v]) => msg.replace(`{${k}}`, v),
        `${key}`
      )
    }
    return key
  },
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('react-redux', () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

let capturedOnComplete: ((result: any) => void) | undefined
vi.mock('@social/social-flows', () => ({
  FBConnectFlow: (props: any) => {
    capturedOnComplete = props.onComplete
    return <div data-testid="fb-connect-flow">FBConnectFlow</div>
  },
  IGConnectFlow: (props: any) => {
    capturedOnComplete = props.onComplete
    return <div data-testid="ig-connect-flow">IGConnectFlow</div>
  },
}))

import SocialFlowsConnectWidget from './SocialFlowsConnectWidget'

describe('SocialFlowsConnectWidget', () => {
  describe('Facebook', () => {
    const defaultProps = {
      appId: 'test-app-123',
      platform: 'facebook',
      onSuccess: vi.fn(),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      capturedOnComplete = undefined
      mockAssociationsData.associations = []
    })

    it('renders FBConnectFlow', () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)
      expect(screen.getByTestId('fb-connect-flow')).toBeInTheDocument()
    })

    it('calls onSuccess after successful link', async () => {
      mockLinkMutateAsync.mockResolvedValue({})
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-123' } },
      })

      await waitFor(() => {
        expect(mockLinkMutateAsync).toHaveBeenCalledWith({
          siteId: 'test-app-123',
          socialId: 'social-123',
          platform: 'facebook',
        })
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    it('unlinks existing association before linking new one', async () => {
      mockAssociationsData.associations = [
        { id: 'assoc-old', platform: 'FACEBOOK', socialId: 'old-social-id' },
      ]
      mockUnlinkMutateAsync.mockResolvedValue({})
      mockLinkMutateAsync.mockResolvedValue({})
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-new' } },
      })

      await waitFor(() => {
        expect(mockUnlinkMutateAsync).toHaveBeenCalledWith({
          siteId: 'test-app-123',
          associationId: 'assoc-old',
        })
        expect(mockLinkMutateAsync).toHaveBeenCalledWith({
          siteId: 'test-app-123',
          socialId: 'social-new',
          platform: 'facebook',
        })
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    it('does not unlink associations from other platforms', async () => {
      mockAssociationsData.associations = [
        { id: 'assoc-ig', platform: 'INSTAGRAM', socialId: 'ig-social-id' },
      ]
      mockLinkMutateAsync.mockResolvedValue({})
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-123' } },
      })

      await waitFor(() => {
        expect(mockUnlinkMutateAsync).not.toHaveBeenCalled()
        expect(mockLinkMutateAsync).toHaveBeenCalled()
      })
    })

    it('shows error when socialId is missing from payload', async () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: {} },
      })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_failed_to_connect_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })

    it('shows error on link failure', async () => {
      mockLinkMutateAsync.mockRejectedValue(new Error('Network error'))
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-123' } },
      })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_failed_to_connect_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })

    it('shows error on ERROR status', async () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({ status: 'ERROR' })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_failed_to_connect_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })

    it('shows incomplete message on INCOMPLETE_EXIT status', async () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({ status: 'INCOMPLETE_EXIT' })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_connection_incomplete_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })

    it('shows error when result is undefined', async () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!(undefined)

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_failed_to_connect_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })
  })

  describe('Instagram', () => {
    const defaultProps = {
      appId: 'test-app-456',
      platform: 'instagram',
      onSuccess: vi.fn(),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      capturedOnComplete = undefined
      mockAssociationsData.associations = []
    })

    it('renders IGConnectFlow', () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)
      expect(screen.getByTestId('ig-connect-flow')).toBeInTheDocument()
    })

    it('calls onSuccess after successful link', async () => {
      mockLinkMutateAsync.mockResolvedValue({})
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-789' } },
      })

      await waitFor(() => {
        expect(mockLinkMutateAsync).toHaveBeenCalledWith({
          siteId: 'test-app-456',
          socialId: 'social-789',
          platform: 'instagram',
        })
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    it('unlinks existing association before linking new one', async () => {
      mockAssociationsData.associations = [
        { id: 'assoc-old-ig', platform: 'INSTAGRAM', socialId: 'old-ig-id' },
      ]
      mockUnlinkMutateAsync.mockResolvedValue({})
      mockLinkMutateAsync.mockResolvedValue({})
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-new-ig' } },
      })

      await waitFor(() => {
        expect(mockUnlinkMutateAsync).toHaveBeenCalledWith({
          siteId: 'test-app-456',
          associationId: 'assoc-old-ig',
        })
        expect(mockLinkMutateAsync).toHaveBeenCalledWith({
          siteId: 'test-app-456',
          socialId: 'social-new-ig',
          platform: 'instagram',
        })
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    it('shows error on link failure', async () => {
      mockLinkMutateAsync.mockRejectedValue(new Error('Network error'))
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-789' } },
      })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_failed_to_connect_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })

    it('shows error on ERROR status', async () => {
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({ status: 'ERROR' })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_failed_to_connect_platform')
        ).toBeInTheDocument()
      })
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })

    it('shows linking state', async () => {
      mockLinkMutateAsync.mockImplementation(
        () => new Promise(() => {}) // never resolves
      )
      render(<SocialFlowsConnectWidget {...defaultProps} />)

      capturedOnComplete!({
        status: 'SUCCESS',
        payload: { socialObject: { socialId: 'social-789' } },
      })

      await waitFor(() => {
        expect(
          screen.getByText('builder_social_linking')
        ).toBeInTheDocument()
      })
    })
  })
})
