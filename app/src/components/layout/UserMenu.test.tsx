/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { DISCORD_INVITE_URL } from '@/constants';
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
const mockPrefetch = vi.fn();
const mockUseSwitchboard = vi.fn();
const mockUseSubscription = vi.fn();
const mockUseVenture = vi.fn();
const mockUseAuthContext = vi.fn();
const mockLogClickEvent = vi.fn(() => vi.fn());
const mockLogImpressionEvent = vi.fn((_eid: string) => vi.fn());

const mockUsePathname = vi.fn(() => '/develop');

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ ...mockRouter(), push: mockPush, prefetch: mockPrefetch }),
}));

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: (...args: unknown[]) => {
    mockLogClickEvent(...args);
    return vi.fn();
  },
  logImpressionEvent: (eid: string) => {
    mockLogImpressionEvent(eid);
    return vi.fn();
  },
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn((selector: (state: { currentAppId: string | null }) => unknown) =>
    selector({ currentAppId: 'test-app-123' })),
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
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

vi.mock('@/hooks/useVenture', () => ({
  useVenture: () => mockUseVenture(),
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

describe('UserMenu', function userMenuTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: true }));
    mockUseSwitchboard.mockReturnValue(false);
    mockUseSubscription.mockReturnValue({ data: undefined, isLoading: false });
    mockUseVenture.mockReturnValue({ ventureId: undefined, isLoading: false });
  });

  describe('when user is authenticated on develop page', function authenticatedDevelopTests() {
    it('should render user icon trigger', function renderTrigger() {
      renderWithProviders(<UserMenu location="develop" />);

      expect(document.body).toBeTruthy();
    });

    it('should show all expected menu items', async function showAllItems() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkItems() {
        expect(screen.getByText('builder_user_menu_all_projects')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_my_products')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_refer_friend')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_join_discord')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_godaddy')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_sign_out')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_common_signin')).not.toBeInTheDocument();
    });

    it('should open /apps in new tab when All Projects is clicked on develop page', async function navigateAllProjectsDevelop() {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      try {
        const { user } = renderWithProviders(<UserMenu location="develop" />);

        await user.click(screen.getByLabelText('builder_user_menu_label'));
        await waitFor(function checkAllProjects() {
          expect(screen.getByText('builder_user_menu_all_projects')).toBeInTheDocument();
        });

        await user.click(screen.getByText('builder_user_menu_all_projects'));

        expect(mockLogClickEvent).toHaveBeenCalledWith('develop.user_menu.all_projects', { appId: 'test-app-123' });
        expect(mockOpen).toHaveBeenCalledWith('/apps', '_blank', 'noopener,noreferrer');
      } finally {
        mockOpen.mockRestore();
      }
    });

    it('should navigate to /apps in same tab when All Projects is clicked outside develop page', async function navigateAllProjectsHomepage() {
      mockUsePathname.mockReturnValue('/apps');
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      try {
        const { user } = renderWithProviders(<UserMenu location="homepage" />);

        await user.click(screen.getByLabelText('builder_user_menu_label'));
        await waitFor(function checkAllProjects() {
          expect(screen.getByText('builder_user_menu_all_projects')).toBeInTheDocument();
        });

        await user.click(screen.getByText('builder_user_menu_all_projects'));

        expect(mockPush).toHaveBeenCalledWith('/apps');
        expect(mockOpen).not.toHaveBeenCalled();
      } finally {
        mockOpen.mockRestore();
        mockUsePathname.mockReturnValue('/develop');
      }
    });

    it('should log menu trigger click', async function logMenuTrigger() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      expect(mockLogClickEvent).toHaveBeenCalledWith('develop.chat_toolbar.user_menu', { appId: 'test-app-123' });
    });

    it('should open correct Discord URL when Join Discord is clicked', async function discordUrl() {
      const mockWindowOpen = vi.fn();
      vi.stubGlobal('open', mockWindowOpen);

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      await waitFor(function checkDiscord() {
        expect(screen.getByText('builder_user_menu_join_discord')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_user_menu_join_discord'));

      expect(mockWindowOpen).toHaveBeenCalledWith(
        DISCORD_INVITE_URL,
        '_blank',
        'noopener,noreferrer'
      );
    });
  });

  describe('when user is unauthenticated', function unauthenticatedTests() {
    beforeEach(function setup() {
      mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: false }));
    });

    it('should show only GoDaddy, Airo and Sign In', async function showUnauthItems() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkItems() {
        expect(screen.getByText('builder_user_menu_godaddy')).toBeInTheDocument();
        expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_user_menu_all_projects')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_user_menu_my_products')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_user_menu_give_feedback')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_user_menu_sign_out')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_user_menu_refer_friend')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_user_menu_join_discord')).not.toBeInTheDocument();
    });
  });

  describe('Manage Plan menu item', function managePlanTests() {
    it('should not show Manage Plan when feature flag is disabled', async function hideWhenFlagDisabled() {
      mockUseSwitchboard.mockReturnValue(false);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkPopoverOpen() {
        expect(screen.getByText('builder_user_menu_sign_out')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_user_menu_manage_plan')).not.toBeInTheDocument();
    });

    it('should not show Manage Plan when subscription is undefined', async function hideWhenNoSubscription() {
      mockUseSwitchboard.mockReturnValue(true);
      mockUseSubscription.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkPopoverOpen() {
        expect(screen.getByText('builder_user_menu_sign_out')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_user_menu_manage_plan')).not.toBeInTheDocument();
    });

    it('should not show Manage Plan when builderEntitlementId is undefined', async function hideWhenNoEntitlementId() {
      mockUseSwitchboard.mockReturnValue(true);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1' }, // no builderEntitlementId
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkPopoverOpen() {
        expect(screen.getByText('builder_user_menu_sign_out')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_user_menu_manage_plan')).not.toBeInTheDocument();
    });

    it('should show Manage Plan when all conditions are met', async function showWhenAllConditionsMet() {
      mockUseSwitchboard.mockReturnValue(true);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkManagePlan() {
        expect(screen.getByText('builder_user_menu_manage_plan')).toBeInTheDocument();
      });
    });

    it('should navigate to /manage-plan when clicked', async function navigateOnClick() {
      mockUseSwitchboard.mockReturnValue(true);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkManagePlan() {
        expect(screen.getByText('builder_user_menu_manage_plan')).toBeInTheDocument();
      });

      // Click the Manage Plan button
      await user.click(screen.getByText('builder_user_menu_manage_plan'));

      // Verify navigation was triggered
      expect(mockPush).toHaveBeenCalledWith('/manage-plan');
    });
  });

  describe('My Products menu item', function myProductsTests() {
    it('should show My Products when authenticated', async function showWhenAuthenticated() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkMyProducts() {
        expect(screen.getByText('builder_user_menu_my_products')).toBeInTheDocument();
      });
    });

    it('should navigate to account products page when clicked', async function navigate() {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      try {
        const { user } = renderWithProviders(<UserMenu location="develop" />);

        await user.click(screen.getByLabelText('builder_user_menu_label'));
        await waitFor(function checkMyProducts() {
          expect(screen.getByText('builder_user_menu_my_products')).toBeInTheDocument();
        });

        await user.click(screen.getByText('builder_user_menu_my_products'));

        expect(mockOpen).toHaveBeenCalledWith(
          'https://account.godaddy.com/products',
          '_blank',
          'noopener,noreferrer'
        );
      } finally {
        mockOpen.mockRestore();
      }
    });
  });

  describe('Dashboard menu item', function dashboardTests() {
    function enableVentureConnectionFlag() {
      mockUseSwitchboard.mockImplementation((flag: string) => flag === 'aab-venture-connection');
    }

    it('should not show Dashboard when ventureId is unavailable', async function hideWithoutVenture() {
      enableVentureConnectionFlag();

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkMyProducts() {
        expect(screen.getByText('builder_user_menu_my_products')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_user_menu_dashboard')).not.toBeInTheDocument();
    });

    it('should not show Dashboard when aab-venture-connection flag is off', async function hideWhenFlagOff() {
      mockUseVenture.mockReturnValue({ ventureId: 'venture-abc', isLoading: false });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkMyProducts() {
        expect(screen.getByText('builder_user_menu_my_products')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_user_menu_dashboard')).not.toBeInTheDocument();
    });

    it('should show Dashboard when flag is on and ventureId is available', async function showWithVenture() {
      enableVentureConnectionFlag();
      mockUseVenture.mockReturnValue({ ventureId: 'venture-abc', isLoading: false });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkDashboard() {
        expect(screen.getByText('builder_user_menu_dashboard')).toBeInTheDocument();
      });
    });

    it('should navigate to venture dashboard when clicked', async function navigate() {
      enableVentureConnectionFlag();
      mockUseVenture.mockReturnValue({ ventureId: 'venture-abc', isLoading: false });

      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      try {
        const { user } = renderWithProviders(<UserMenu location="develop" />);

        await user.click(screen.getByLabelText('builder_user_menu_label'));
        await waitFor(function checkDashboard() {
          expect(screen.getByText('builder_user_menu_dashboard')).toBeInTheDocument();
        });

        await user.click(screen.getByText('builder_user_menu_dashboard'));

        expect(mockOpen).toHaveBeenCalledWith(
          'https://dashboard.godaddy.com/venture?ventureId=venture-abc',
          '_blank',
          'noopener,noreferrer'
        );
      } finally {
        mockOpen.mockRestore();
      }
    });

    it('should appear after My Products in the menu', async function order() {
      enableVentureConnectionFlag();
      mockUseVenture.mockReturnValue({ ventureId: 'venture-abc', isLoading: false });

      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkBoth() {
        expect(screen.getByText('builder_user_menu_my_products')).toBeInTheDocument();
        expect(screen.getByText('builder_user_menu_dashboard')).toBeInTheDocument();
      });

      const myProducts = screen.getByText('builder_user_menu_my_products');
      const dashboard = screen.getByText('builder_user_menu_dashboard');
      const position = myProducts.compareDocumentPosition(dashboard);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('GoDaddy menu item', function godaddyTests() {
    it('should show GoDaddy when authenticated', async function showWhenAuthenticated() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkGoDaddy() {
        expect(screen.getByText('builder_user_menu_godaddy')).toBeInTheDocument();
      });
    });

    it('should navigate to godaddy.com when clicked', async function navigate() {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

      try {
        const { user } = renderWithProviders(<UserMenu location="develop" />);

        await user.click(screen.getByLabelText('builder_user_menu_label'));
        await waitFor(function checkGoDaddy() {
          expect(screen.getByText('builder_user_menu_godaddy')).toBeInTheDocument();
        });

        await user.click(screen.getByText('builder_user_menu_godaddy'));

        expect(mockOpen).toHaveBeenCalledWith('https://www.godaddy.com', '_blank', 'noopener,noreferrer');
      } finally {
        mockOpen.mockRestore();
      }
    });
  });

  describe('Give Feedback button', function giveFeedbackTests() {
    it('should show Give Feedback when authenticated', async function showWhenAuthenticated() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));

      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
      });
    });

    it('should open feedback modal when Give Feedback is clicked', async function openModal() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_user_menu_give_feedback'));

      await waitFor(function checkModalOpen() {
        expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
      });
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('feedback.modal.userOpened');
    });

    it('should close popover when Give Feedback is clicked', async function closePopover() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_user_menu_give_feedback'));

      await waitFor(function checkPopoverClosed() {
        expect(screen.queryByText('builder_user_menu_sign_out')).not.toBeInTheDocument();
      });
    });

    it('should close feedback modal via onClose callback', async function closeViaOnClose() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_user_menu_give_feedback'));
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

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_user_menu_give_feedback'));
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

      await user.click(screen.getByLabelText('builder_user_menu_label'));
      await waitFor(function checkFeedbackButton() {
        expect(screen.getByText('builder_user_menu_give_feedback')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_user_menu_give_feedback'));

      expect(removeItemSpy).not.toHaveBeenCalledWith(expect.stringContaining('airo-feedback-shown'));
    });
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
      mockUseSwitchboard.mockReturnValue(true);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).toHaveBeenCalledWith('/manage-plan');
    });

    it('should not prefetch /manage-plan when feature flag is off', function noPrefetchManagePlanFlagOff() {
      mockUseSwitchboard.mockReturnValue(false);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).not.toHaveBeenCalledWith('/manage-plan');
    });

    it('should not prefetch /manage-plan when unauthenticated even if showManagePlan would be true', function noPrefetchManagePlanUnauthed() {
      mockUseAuthContext.mockReturnValue(mockAuthContext({ isAuthenticated: false }));
      mockUseSwitchboard.mockReturnValue(true);
      mockUseSubscription.mockReturnValue({
        data: { id: 'sub-1', builderEntitlementId: 'entitlement-123' },
        isLoading: false,
      });

      renderWithProviders(<UserMenu location="develop" />);

      expect(mockPrefetch).not.toHaveBeenCalledWith('/manage-plan');
    });
  });
});
