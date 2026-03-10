import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SessionExpirationBanner from './SessionExpirationBanner';

const mockOpenSsoLogin = vi.fn();

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: vi.fn(() => ({ openSsoLogin: mockOpenSsoLogin })),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockLogImpressionEvent = vi.fn(() => vi.fn());
const mockLogClickEvent = vi.fn(() => vi.fn());

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string) => mockLogImpressionEvent(eid),
  logClickEvent: (eid: string) => mockLogClickEvent(eid),
}));

function dispatchSessionExpiringEvent(minutesRemaining: number = 5) {
  const event = new CustomEvent('session-expiring', {
    detail: {
      expiresAt: Date.now() + minutesRemaining * 60 * 1000,
      minutesRemaining,
      timeUntilExpiry: minutesRemaining * 60 * 1000,
    },
  });
  window.dispatchEvent(event);
}

function dispatchSessionSafeEvent() {
  window.dispatchEvent(new CustomEvent('session-safe'));
}

describe('SessionExpirationBanner', function sessionExpirationBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockLogImpressionEvent.mockClear();
    mockLogClickEvent.mockClear();
  });

  describe('rendering', function renderingTests() {
    it('should not render initially', function notRenderInitially() {
      const { container } = renderWithProviders(<SessionExpirationBanner />);

      expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).not.toBeInTheDocument();
    });

    it('should render when session-expiring event is dispatched', async function renderOnEvent() {
      const { container } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });
    });

    it('should hide when session-safe event is dispatched', async function hideOnSafeEvent() {
      const { container } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      act(() => {
        dispatchSessionSafeEvent();
      });

      await waitFor(function waitForHide() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).not.toBeInTheDocument();
      });
    });
  });

  describe('interactions', function interactionTests() {
    it('should call openSsoLogin when extend session button is clicked', async function extendSession() {
      const { user } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button', { name: /extend/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /extend/i }));

      expect(mockOpenSsoLogin).toHaveBeenCalled();
    });

    it('should dismiss when close button is clicked', async function dismissOnClose() {
      const { user, container } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      // Close button is the button with aria-label containing "close"
      const closeButton = screen.getByLabelText(/close/i);
      await user.click(closeButton);

      await waitFor(function waitForDismiss() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).not.toBeInTheDocument();
      });
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log impression event when banner is shown', async function logImpressionOnShow() {
      const { container } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.sessionExpirationBanner.view');
    });

    it('should log click event when extend session button is clicked', async function logClickOnExtend() {
      const { user } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button', { name: /extend/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /extend/i }));

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.sessionExpirationBanner.extend');
    });

    it('should log click event when close button is clicked', async function logClickOnClose() {
      const { user, container } = renderWithProviders(<SessionExpirationBanner />);

      act(() => {
        dispatchSessionExpiringEvent(5);
      });

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText(/close/i);
      await user.click(closeButton);

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.sessionExpirationBanner.close');
    });
  });
});
