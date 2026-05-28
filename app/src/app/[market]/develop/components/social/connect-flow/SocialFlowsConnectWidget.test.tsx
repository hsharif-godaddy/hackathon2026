/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ market: 'en-US' }),
}))

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}))

const mockMutateAsync = vi.fn()
vi.mock('@/hooks/social/mutations/useLinkConnection', () => ({
  useLinkConnection: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

let capturedOnComplete: ((result: any) => void) | undefined
vi.mock('@social/social-flows', () => ({
  FBConnectFlow: (props: any) => {
    capturedOnComplete = props.onComplete
    return <div data-testid="fb-connect-flow">FBConnectFlow</div>
  },
}))

vi.mock('react-redux', () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import SocialFlowsConnectWidget from './SocialFlowsConnectWidget'

describe('SocialFlowsConnectWidget', () => {
  const defaultProps = {
    appId: 'test-app-123',
    businessName: 'My Business',
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnComplete = undefined
  })

  it('renders FBConnectFlow', () => {
    render(<SocialFlowsConnectWidget {...defaultProps} />)
    expect(screen.getByTestId('fb-connect-flow')).toBeInTheDocument()
  })

  it('calls onSuccess after successful link', async () => {
    mockMutateAsync.mockResolvedValue({})
    render(<SocialFlowsConnectWidget {...defaultProps} />)

    capturedOnComplete!({
      status: 'SUCCESS',
      payload: { socialObject: { socialId: 'social-123' } },
    })

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        siteId: 'test-app-123',
        socialId: 'social-123',
        platform: 'facebook',
      })
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })

  it('calls onSuccess immediately with skipLink', async () => {
    render(<SocialFlowsConnectWidget {...defaultProps} skipLink />)

    capturedOnComplete!({
      status: 'SUCCESS',
      payload: { socialObject: { socialId: 'social-123' } },
    })

    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).toHaveBeenCalled()
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
        screen.getByText('Connection succeeded but no account ID was returned.')
      ).toBeInTheDocument()
    })
    expect(defaultProps.onSuccess).not.toHaveBeenCalled()
  })

  it('shows error on link failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Network error'))
    render(<SocialFlowsConnectWidget {...defaultProps} />)

    capturedOnComplete!({
      status: 'SUCCESS',
      payload: { socialObject: { socialId: 'social-123' } },
    })

    await waitFor(() => {
      expect(
        screen.getByText(/Connected to Facebook but failed to link account/)
      ).toBeInTheDocument()
    })
    expect(defaultProps.onSuccess).not.toHaveBeenCalled()
  })

  it('shows error on ERROR status', async () => {
    render(<SocialFlowsConnectWidget {...defaultProps} />)

    capturedOnComplete!({ status: 'ERROR' })

    await waitFor(() => {
      expect(
        screen.getByText('Facebook connection failed. Please try again.')
      ).toBeInTheDocument()
    })
    expect(defaultProps.onSuccess).not.toHaveBeenCalled()
  })

  it('shows error on INCOMPLETE_EXIT status', async () => {
    render(<SocialFlowsConnectWidget {...defaultProps} />)

    capturedOnComplete!({ status: 'INCOMPLETE_EXIT' })

    await waitFor(() => {
      expect(
        screen.getByText('Connection was not completed.')
      ).toBeInTheDocument()
    })
    expect(defaultProps.onSuccess).not.toHaveBeenCalled()
  })

  it('shows error when result is undefined', async () => {
    render(<SocialFlowsConnectWidget {...defaultProps} />)

    capturedOnComplete!(undefined)

    await waitFor(() => {
      expect(
        screen.getByText('Connection flow returned no result.')
      ).toBeInTheDocument()
    })
    expect(defaultProps.onSuccess).not.toHaveBeenCalled()
  })
})
