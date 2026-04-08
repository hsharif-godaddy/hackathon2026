/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { FEEDBACK_ID } from '@/components/feedback/utils';
import { renderWithProviders } from '@/tests/test-utils';
import FeedbackBanner from './FeedbackBanner';

const mockOpenFeedbackModal = vi.fn();

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({ openFeedbackModal: mockOpenFeedbackModal }),
}));

const mockLogImpressionEvent = vi.fn((_eid: string) => vi.fn());
const mockLogClickEvent = vi.fn((_eid: string) => vi.fn());

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string) => mockLogImpressionEvent(eid),
  logClickEvent: (eid: string) => mockLogClickEvent(eid),
}));

let shouldRenderButtonInMock = false;

vi.mock('react-intl', async () => {
  const actual = await vi.importActual<typeof import('react-intl')>('react-intl');
  return {
    ...actual,
    FormattedMessage: ({ id, values }: { id: string; values?: { link?: ReactNode } }) => {
      // When shouldRenderButtonInMock is true, render the button for testing click handler
      if (shouldRenderButtonInMock && values?.link) {
        return values.link;
      }
      return id;
    },
  };
});

describe('FeedbackBanner', function feedbackBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    localStorage.clear();
    mockLogImpressionEvent.mockClear();
    mockLogClickEvent.mockClear();
    shouldRenderButtonInMock = false;
  });

  describe('rendering', function renderingTests() {
    it('should render when not dismissed', async function renderWhenNotDismissed() {
      const { container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });
    });

    it('should not render when dismissed', async function notRenderWhenDismissed() {
      const { container, rerender, user } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      rerender(<FeedbackBanner />);

      await waitFor(function waitForDismiss() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
      });
    });

    it('should render feedback message', async function renderMessage() {
      renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForMessage() {
        // FormattedMessage renders the message ID when no translations are provided
        expect(screen.getByText('builder_feedback_banner_message')).toBeInTheDocument();
      });
    });
  });

  describe('interactions', function interactionTests() {
    it('should dismiss when close button is clicked', async function dismissOnClose() {
      const { user, container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      await waitFor(function waitForDismiss() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
      });
    });

    it('should call openFeedbackModal and dismiss when feedback link is clicked', async function clickFeedbackLink() {
      shouldRenderButtonInMock = true;

      const { user, container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const feedbackLink = screen.getByRole('link');
      await user.click(feedbackLink);

      expect(mockOpenFeedbackModal).toHaveBeenCalledWith(FEEDBACK_ID, 'Session feedback');

      await waitFor(function waitForDismiss() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
      });
    });

    it('should clear localStorage key before opening feedback modal', async function clearLocalStorageBeforeOpen() {
      shouldRenderButtonInMock = true;

      // Set the localStorage key to simulate it being shown before
      localStorage.setItem(`airo-feedback-shown:${FEEDBACK_ID}`, 'true');

      const { user, container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const feedbackLink = screen.getByRole('link');
      await user.click(feedbackLink);

      // Verify localStorage key was removed
      expect(localStorage.getItem(`airo-feedback-shown:${FEEDBACK_ID}`)).toBeNull();
      expect(mockOpenFeedbackModal).toHaveBeenCalledWith(FEEDBACK_ID, 'Session feedback');
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log impression event when banner is shown', async function logImpressionOnShow() {
      const { container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.feedbackBanner.view');
    });

    it('should not log impression event again when already logged', async function noDoubleImpression() {
      const { container, rerender } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);

      // Re-render and check it doesn't log again
      rerender(<FeedbackBanner />);

      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    });

    it('should log click event when close button is clicked', async function logClickOnClose() {
      const { user, container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.feedbackBanner.close');
    });

    it('should log click event when feedback link is clicked', async function logClickOnFeedback() {
      shouldRenderButtonInMock = true;

      const { user, container } = renderWithProviders(<FeedbackBanner />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const feedbackLink = screen.getByRole('link');
      await user.click(feedbackLink);

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.feedbackBanner.feedback');
    });
  });
});
