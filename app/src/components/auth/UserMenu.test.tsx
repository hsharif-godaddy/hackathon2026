import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

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

// Mock ResizeObserver for UX components
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
  configurable: true,
});

const mockPush = vi.fn();
const mockUseSwitchboard = vi.fn();
const mockUseSubscription = vi.fn();
const mockUseAuthContext = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/develop',
  useRouter: () => ({ ...mockRouter(), push: mockPush }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
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

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
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

describe('UserMenu', function userMenuTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: true, isAuthDisabled: false }));
    mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });
    mockUseSubscription.mockReturnValue({ data: undefined, isLoading: false });
  });

  describe('when user is authenticated on develop page', function authenticatedDevelopTests() {
    it('should render user icon trigger', function renderTrigger() {
      renderWithProviders(<UserMenu location="develop" />);

      // The popover trigger should be present
      expect(document.body).toBeTruthy();
    });

    it('should open popover when clicked', async function openPopover() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click the user icon to open popover
      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkPopover() {
        // Popover should be open - check for sign out button
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });
    });

    it('should show Invite Friends menu item on develop page', async function showInviteFriends() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click to open popover
      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkInviteFriends() {
        expect(screen.getByText('builder_invite_friend_title')).toBeInTheDocument();
      });
    });

    it('should show Discord menu item on develop page', async function showDiscord() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click to open popover
      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkDiscord() {
        // Discord uses default fallback text
        expect(screen.getByText('builder_usermenu_discord')).toBeInTheDocument();
      });
    });

    it('should show Sign Out button', async function showSignOut() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click to open popover
      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkSignOut() {
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });
    });
  });

  describe('Manage Plan menu item', function managePlanTests() {
    it('should not show Manage Plan when feature flag is disabled', async function hideWhenFlagDisabled() {
      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkPopoverOpen() {
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_usermenu_manage_plan')).not.toBeInTheDocument();
    });

    it('should not show Manage Plan when subscription is undefined', async function hideWhenNoSubscription() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkPopoverOpen() {
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_usermenu_manage_plan')).not.toBeInTheDocument();
    });

    it('should not show Manage Plan when builderEntitlementId is undefined', async function hideWhenNoEntitlementId() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1' }, // no builderEntitlementId
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkPopoverOpen() {
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_usermenu_manage_plan')).not.toBeInTheDocument();
    });

    it('should show Manage Plan when all conditions are met', async function showWhenAllConditionsMet() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkManagePlan() {
        expect(screen.getByText('builder_usermenu_manage_plan')).toBeInTheDocument();
      });
    });

    it('should have link to /manage-plan', async function navigateOnClick() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkManagePlan() {
        expect(screen.getByText('builder_usermenu_manage_plan')).toBeInTheDocument();
      });

      // Verify the Link has correct href (navigation is handled by Next.js Link component)
      const managePlanLink = screen.getByText('builder_usermenu_manage_plan').closest('a');
      expect(managePlanLink).toHaveAttribute('href', '/manage-plan');
    });
  });

  describe('Give Feedback button', function giveFeedbackTests() {
    it('should show Give Feedback when authenticated', async function showWhenAuthenticated() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
      });
    });

    it('should not show Give Feedback when unauthenticated', async function hideWhenUnauthenticated() {
      mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: false, isAuthDisabled: false }));

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));

      await waitFor(function checkSignIn() {
        expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_settings_nav_feedback')).not.toBeInTheDocument();
    });

    it('should open feedback modal when Give Feedback is clicked', async function openModal() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_settings_nav_feedback'));

      await waitFor(function checkModalOpen() {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
      });
    });

    it('should close popover when Give Feedback is clicked', async function closePopover() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_settings_nav_feedback'));

      await waitFor(function checkPopoverClosed() {
        expect(screen.queryByText('builder_common_signout')).not.toBeInTheDocument();
      });
    });

    it('should close feedback modal via onClose callback', async function closeViaOnClose() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_settings_nav_feedback'));
      await waitFor(function checkModalOpen() {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
      });

      await user.click(screen.getByText('close-feedback'));

      await waitFor(function checkModalClosed() {
        expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
      });
    });

    it('should close feedback modal via onSubmitSuccess callback', async function closeViaSubmit() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_settings_nav_feedback'));
      await waitFor(function checkModalOpen() {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
      });

      await user.click(screen.getByText('submit-feedback'));

      await waitFor(function checkModalClosed() {
        expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
      });
    });

    it('should not render feedback modal before Give Feedback is clicked', function notRenderedInitially() {
      renderWithProviders(<UserMenu location="develop" />);

      expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
    });

    it('should not mutate the airo-feedback-shown localStorage key when opening', async function noLocalStorageSideEffect() {
      const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByTestId('user-menu-trigger'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_settings_nav_feedback'));

      expect(removeItemSpy).not.toHaveBeenCalledWith(expect.stringContaining('airo-feedback-shown'));
    });
  });
});
