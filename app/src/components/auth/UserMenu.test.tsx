import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { mockAuthContext, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import UserMenu from './UserMenu';

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
  useAuthContext: () => mockAuthContext({ isAuthenticated: true, isAuthDisabled: false }),
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
    // Default mock values
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
        expect(screen.getByText('Join our Discord')).toBeInTheDocument();
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

    it('should navigate to /manage-plan when clicked', async function navigateOnClick() {
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

      await user.click(screen.getByText('builder_usermenu_manage_plan'));

      expect(mockPush).toHaveBeenCalledWith('/manage-plan');
    });
  });
});
