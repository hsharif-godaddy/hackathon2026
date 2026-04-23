/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAuthContext, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import UserMenu from './UserMenu';

vi.mock('@/components/feedback/Feedback', () => ({
  Feedback: ({ onClose, onSubmitSuccess }: { onClose: () => void; onSubmitSuccess: () => void }) => (
    <div data-testid="feedback-modal">
      <button onClick={onClose}>close-feedback</button>
      <button onClick={onSubmitSuccess}>submit-feedback</button>
    </div>
  ),
}));

vi.mock('@/components/feedback/utils', () => ({
  FEEDBACK_ID: 'airo#app-builder',
}));

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

const mockPush = vi.fn();
const mockPrefetch = vi.fn();
const mockUseSwitchboard = vi.fn();
const mockUseSubscription = vi.fn();
const mockUseAuthContext = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/develop',
  useRouter: () => ({ ...mockRouter(), push: mockPush, prefetch: mockPrefetch }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => id),
}));

vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({
    signIn: vi.fn(),
  }),
}));

vi.mock('@/hooks/useReferralLink', () => ({
  useReferralLink: () => ({
    referralLink: 'https://test.com?referralId=abc123',
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockUseSwitchboard(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

describe('light_homepage UserMenu', function lightHomepageUserMenuTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: true }));
    mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });
    mockUseSubscription.mockReturnValue({ data: undefined, isLoading: false });
  });

  describe('route prefetching', function prefetchTests() {
    it('should prefetch /apps when authenticated', function prefetchApps() {
      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).toHaveBeenCalledWith('/apps');
    });

    it('should not prefetch /apps when unauthenticated', function noPrefetchWhenUnauthed() {
      mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: false }));

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).not.toHaveBeenCalledWith('/apps');
    });

    it('should prefetch /manage-plan when manage plan is available', function prefetchManagePlan() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).toHaveBeenCalledWith('/manage-plan');
    });

    it('should not prefetch /manage-plan when feature flag is off', function noPrefetchManagePlanFlagOff() {
      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).not.toHaveBeenCalledWith('/manage-plan');
    });

    it('should not prefetch /manage-plan when unauthenticated even if showManagePlan would be true', function noPrefetchManagePlanUnauthed() {
      mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: false }));
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).not.toHaveBeenCalledWith('/manage-plan');
    });
  });
});
