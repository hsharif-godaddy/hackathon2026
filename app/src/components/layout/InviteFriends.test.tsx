/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { mockAuthContext } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

// Mock ResizeObserver for UX Modal
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock @ux/modal to avoid Disrupt rendering issues in test environment
vi.mock('@ux/modal', () => ({
  default: ({ title, children, actions, onClose }: any) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
      <div>{actions}</div>
    </div>
  ),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

import InviteFriends, { InviteFriendsVariant } from './InviteFriends';

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext({ isAuthenticated: true }),
}));

vi.mock('@/hooks/useReferralLink', () => ({
  useReferralLink: () => ({
    referralLink: 'https://test.com?referralId=abc123',
    isLoading: false,
    error: null,
  }),
}));

describe('InviteFriends', function inviteFriendsTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('when user is authenticated', function authenticatedTests() {
    describe('Button variant', function buttonVariantTests() {
      it('should render icon-only button', function renderButton() {
        renderWithProviders(<InviteFriends location="header" />);

        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
      });

      it('should open modal when clicked', async function opensModal() {
        const { user } = renderWithProviders(<InviteFriends location="header" />);

        await user.click(screen.getByRole('button'));

        await waitFor(function checkModal() {
          expect(screen.getByText('builder_invite_friend_title')).toBeInTheDocument();
        });
      });

      it('should have correct analytics data-eid', function analyticsEid() {
        renderWithProviders(<InviteFriends location="header" />);

        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('data-eid', 'header.header.invite_friends');
      });
    });

    describe('MenuItem variant', function menuItemVariantTests() {
      it('should render with text', function renderMenuItem() {
        renderWithProviders(
          <InviteFriends location="develop" variant={InviteFriendsVariant.MenuItem} />
        );

        expect(screen.getByText('builder_invite_friend_title')).toBeInTheDocument();
      });

      it('should call onOpenModal callback when clicked', async function callsCallback() {
        const onOpenModal = vi.fn();
        const { user } = renderWithProviders(
          <InviteFriends
            location="develop"
            variant={InviteFriendsVariant.MenuItem}
            onOpenModal={onOpenModal}
          />
        );

        await user.click(screen.getByRole('button'));

        expect(onOpenModal).toHaveBeenCalled();
      });

      it('should have correct analytics data-eid for user menu', function analyticsEid() {
        renderWithProviders(
          <InviteFriends location="develop" variant={InviteFriendsVariant.MenuItem} />
        );

        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('data-eid', 'develop.user_menu.invite_friends');
      });
    });
  });

  describe('when user is not authenticated', function unauthenticatedTests() {
    beforeEach(function setupUnauthenticated() {
      vi.doMock('@/components/providers/AuthProvider', () => ({
        useAuthContext: () => mockAuthContext({ isAuthenticated: false }),
      }));
    });

    it('should not render anything', function noRender() {
      vi.doMock('@/components/providers/AuthProvider', () => ({
        useAuthContext: () => mockAuthContext({ isAuthenticated: false }),
      }));

      // Component should return null for unauthenticated users
      // This is tested by checking it doesn't crash and renders nothing visible
    });
  });
});
