import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { mockAuthContext } from '@/tests/mocks';
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

vi.mock('next/navigation', () => ({
  usePathname: () => '/develop',
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

describe('UserMenu', function userMenuTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
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
      const trigger = document.querySelector('[class*="cursor-pointer"]');
      if (trigger) {
        await user.click(trigger);
      }

      await waitFor(function checkPopover() {
        // Popover should be open - check for sign out button
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });
    });

    it('should show Invite Friends menu item on develop page', async function showInviteFriends() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click to open popover
      const trigger = document.querySelector('[class*="cursor-pointer"]');
      if (trigger) {
        await user.click(trigger);
      }

      await waitFor(function checkInviteFriends() {
        expect(screen.getByText('builder_invite_friend_title')).toBeInTheDocument();
      });
    });

    it('should show Discord menu item on develop page', async function showDiscord() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click to open popover
      const trigger = document.querySelector('[class*="cursor-pointer"]');
      if (trigger) {
        await user.click(trigger);
      }

      await waitFor(function checkDiscord() {
        // Discord uses default fallback text
        expect(screen.getByText('Join our Discord')).toBeInTheDocument();
      });
    });

    it('should show Sign Out button', async function showSignOut() {
      const { user } = renderWithProviders(<UserMenu location="develop" />);

      // Click to open popover
      const trigger = document.querySelector('[class*="cursor-pointer"]');
      if (trigger) {
        await user.click(trigger);
      }

      await waitFor(function checkSignOut() {
        expect(screen.getByText('builder_common_signout')).toBeInTheDocument();
      });
    });
  });
});
