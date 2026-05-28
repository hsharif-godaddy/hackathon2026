import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AsyncIcon from '@ux/icon/async-icon.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CtaButton, type CtaButtonProps } from '../index';

beforeAll(() => {
  // `@ux/icon/async-icon.js` fetches SVG from an asset host; jsdom has no network.
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;

    if (url.includes('/ux-assets/@ux/icon/') || url.includes('img6.wsimg.com')) {
      return Promise.resolve(
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch in CtaButton tests: ${url}`));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

const BASE: CtaButtonProps = {
  icon: <AsyncIcon icon="user-locked" />,
  title: 'Test Title',
  description: 'Test description text',
  onClose: vi.fn(),
};

function renderCta(overrides?: Partial<CtaButtonProps>) {
  return render(<CtaButton {...BASE} {...overrides} />);
}

describe('CtaButton', () => {
  describe('rendering', () => {
    it('renders the title', () => {
      renderCta();
      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    it('renders default title when not provided', () => {
      renderCta({ title: undefined });
      expect(screen.getByText('Action Required')).toBeInTheDocument();
    });

    it('renders the description', () => {
      renderCta();
      expect(screen.getByText('Test description text')).toBeInTheDocument();
    });

    it('renders the icon', () => {
      const { container } = renderCta();
      expect(container.querySelector('.airo-input-cta-button__icon svg')).toBeInTheDocument();
    });

    it('renders the close button in pending state', () => {
      renderCta({ status: 'pending' });
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('renders custom close label', () => {
      renderCta({ status: 'pending', closeLabel: 'Dismiss' });
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('does not render the close button in processing state', () => {
      renderCta({ status: 'processing' });
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('does not render the close button in success state', () => {
      renderCta({ status: 'success' });
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('does not render the close button in error state', () => {
      renderCta({ status: 'error' });
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('renders helper text when provided', () => {
      renderCta({ helperText: 'A popup window will open' });
      expect(screen.getByText('A popup window will open')).toBeInTheDocument();
    });

    it('does not render helper text when not provided', () => {
      renderCta({ helperText: undefined });
      expect(screen.queryByText('A popup window will open')).not.toBeInTheDocument();
    });

    it('renders the action button with custom label', () => {
      renderCta({ actionLabel: 'Authenticate' });
      expect(screen.getByRole('button', { name: 'Authenticate' })).toBeInTheDocument();
    });

    it('renders default action label when not provided', () => {
      renderCta();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    it('merges className and forwards div passthrough props on the root', () => {
      const { container } = renderCta({
        className: 'host-extra',
        lang: 'de',
      });
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveClass('airo-input-cta-button', 'host-extra');
      expect(root).toHaveAttribute('lang', 'de');
    });

    it('omits the borderless class on the root by default', () => {
      const { container } = renderCta();
      expect(container.firstElementChild).not.toHaveClass('airo-input-cta-button--borderless');
    });

    it('applies the borderless class on the root when borderless is true', () => {
      const { container } = renderCta({ borderless: true });
      expect(container.firstElementChild).toHaveClass('airo-input-cta-button--borderless');
    });
  });

  describe('status states', () => {
    it('defaults to pending state when status is not provided', () => {
      renderCta();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('shows action button in pending state', () => {
      renderCta({ status: 'pending', actionLabel: 'Go' });
      expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Go' })).not.toBeDisabled();
    });

    it('shows processing message in processing state', () => {
      renderCta({ status: 'processing' });
      expect(screen.getByText('Processing...')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    it('shows custom processing message when provided', () => {
      renderCta({ status: 'processing', processingMessage: 'Authenticating...' });
      expect(screen.getByText('Authenticating...')).toBeInTheDocument();
    });

    it('shows success message in success state', () => {
      const { container } = renderCta({ status: 'success', successMessage: 'Done!' });
      expect(screen.getByText('Done!')).toBeInTheDocument();
      const statusIcon = container.querySelector('.airo-input-cta-button__status-icon svg');
      expect(statusIcon).toBeInTheDocument();
    });

    it('shows default success message when not provided', () => {
      renderCta({ status: 'success' });
      expect(screen.getByText('Action completed successfully')).toBeInTheDocument();
    });

    it('shows error message and retry/cancel buttons in error state', () => {
      const { container } = renderCta({ status: 'error', errorMessage: 'Something went wrong' });
      expect(screen.getByText('Action failed')).toBeInTheDocument();
      const statusIcon = container.querySelector('.airo-input-cta-button__status-icon svg');
      expect(statusIcon).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('shows custom error label when provided', () => {
      renderCta({ status: 'error', errorLabel: 'Authentication error' });
      expect(screen.getByText('Authentication error')).toBeInTheDocument();
    });

    it('shows error state without custom error message', () => {
      const { container } = renderCta({ status: 'error' });
      expect(screen.getByText('Action failed')).toBeInTheDocument();
      const statusIcon = container.querySelector('.airo-input-cta-button__status-icon svg');
      expect(statusIcon).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('shows custom retry and cancel labels in error state', () => {
      renderCta({
        status: 'error',
        retryLabel: 'Retry Action',
        cancelLabel: 'Dismiss',
      });
      expect(screen.getByRole('button', { name: 'Retry Action' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      renderCta({ onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onAction when action button is clicked', async () => {
      const onAction = vi.fn();
      renderCta({ onAction, actionLabel: 'Act' });
      await userEvent.click(screen.getByRole('button', { name: 'Act' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('does nothing when action button is clicked without onAction', async () => {
      renderCta({ onAction: undefined, actionLabel: 'Act' });
      const button = screen.getByRole('button', { name: 'Act' });
      await userEvent.click(button);
      // No error should be thrown, button should remain enabled
      expect(button).not.toBeDisabled();
    });

    it('calls onAction when retry button is clicked in error state', async () => {
      const onAction = vi.fn();
      renderCta({ status: 'error', onAction });
      await userEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when cancel button is clicked in error state', async () => {
      const onClose = vi.fn();
      renderCta({ status: 'error', onClose });
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('disables action button while onAction promise is pending', async () => {
      let resolvePromise: (() => void) | undefined;
      const promise = new Promise<void>((res) => {
        resolvePromise = res;
      });
      const onAction = vi.fn(() => promise);

      renderCta({ onAction, actionLabel: 'Go' });
      const button = screen.getByRole('button', { name: 'Go' });

      await userEvent.click(button);
      expect(onAction).toHaveBeenCalledTimes(1);

      // Button should be disabled while promise is pending
      expect(button).toBeDisabled();

      // Resolve the promise
      if (resolvePromise) {
        resolvePromise();
      }
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });

    it('prevents multiple simultaneous onAction calls', async () => {
      let resolvePromise: (() => void) | undefined;
      const promise = new Promise<void>((res) => {
        resolvePromise = res;
      });
      const onAction = vi.fn(() => promise);

      renderCta({ onAction, actionLabel: 'Go' });
      const button = screen.getByRole('button', { name: 'Go' });

      // Click once
      await userEvent.click(button);
      expect(onAction).toHaveBeenCalledTimes(1);

      // Try to click again while processing
      await userEvent.click(button);
      // Should still only have been called once
      expect(onAction).toHaveBeenCalledTimes(1);

      // Resolve the promise
      if (resolvePromise) {
        resolvePromise();
      }
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });

    it('prevents action when status is processing', async () => {
      const onAction = vi.fn();
      renderCta({ status: 'processing', onAction });
      // No action button in processing state
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    it('prevents action when internal processing state is true', async () => {
      let resolvePromise: (() => void) | undefined;
      const promise = new Promise<void>((res) => {
        resolvePromise = res;
      });
      const onAction = vi.fn(() => promise);

      renderCta({ status: 'pending', onAction, actionLabel: 'Go' });
      const button = screen.getByRole('button', { name: 'Go' });

      // Trigger processing
      await userEvent.click(button);
      expect(button).toBeDisabled();

      // Clean up
      if (resolvePromise) {
        resolvePromise();
      }
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });

    it('supports async onAction', async () => {
      let resolved = false;
      const onAction = vi.fn(async () => {
        await new Promise((res) => setTimeout(res, 10));
        resolved = true;
      });

      renderCta({ onAction, actionLabel: 'Go' });
      await userEvent.click(screen.getByRole('button', { name: 'Go' }));

      await waitFor(() => {
        expect(resolved).toBe(true);
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('supports sync onAction', async () => {
      const onAction = vi.fn();
      renderCta({ onAction, actionLabel: 'Go' });
      await userEvent.click(screen.getByRole('button', { name: 'Go' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('wraps sync onAction in Promise.resolve', async () => {
      let called = false;
      const onAction = vi.fn(() => {
        called = true;
      });

      renderCta({ onAction, actionLabel: 'Go' });
      const button = screen.getByRole('button', { name: 'Go' });
      await userEvent.click(button);

      expect(called).toBe(true);
      expect(onAction).toHaveBeenCalledTimes(1);
      // Button should be re-enabled immediately after sync action
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });
  });

  describe('accessibility', () => {
    it('renders title as h3 for heading semantics', () => {
      const { container } = renderCta({ title: 'Auth Required' });
      const heading = container.querySelector('h3');
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Auth Required');
    });

    it('sets aria-label on close button', () => {
      renderCta({ closeLabel: 'Dismiss' });
      const button = screen.getByRole('button', { name: 'Dismiss' });
      expect(button).toHaveAttribute('aria-label', 'Dismiss');
    });

    it('marks icon as aria-hidden', () => {
      const { container } = renderCta();
      const iconSpan = container.querySelector('.airo-input-cta-button__icon');
      expect(iconSpan).toHaveAttribute('aria-hidden', 'true');
    });

    it('marks status icons as aria-hidden', () => {
      const { container } = renderCta({ status: 'success' });
      const statusIcon = container.querySelector('.airo-input-cta-button__status-icon');
      expect(statusIcon).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
