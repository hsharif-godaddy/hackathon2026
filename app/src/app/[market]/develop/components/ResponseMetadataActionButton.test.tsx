/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import ResponseMetadataActionButton, {
  TOOLTIP_SHOW_DELAY_MS,
} from '@/app/[market]/develop/components/ResponseMetadataActionButton';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@ux/tooltip', () => ({
  default: ({ children, placement }: { children: ReactNode; placement?: string }) => (
    <div data-testid="tooltip" data-placement={placement}>
      {children}
    </div>
  ),
}));

const TestIcon = () => <span data-testid="action-icon">icon</span>;

function renderButton(onClick = vi.fn()) {
  return renderWithProviders(
    <ResponseMetadataActionButton
      label="Copy response"
      icon={<TestIcon />}
      data-eid="test.copy"
      onClick={onClick}
    />
  );
}

function getAnchor() {
  const button = screen.getByRole('button', { name: 'Copy response' });
  const anchor = button.parentElement;
  if (!anchor) {
    throw new Error('tooltip anchor not found');
  }
  return { button, anchor };
}

describe('ResponseMetadataActionButton', function responseMetadataActionButtonTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(function teardown() {
    vi.useRealTimers();
  });

  describe('rendering', function renderingTests() {
    it('should render the action button with aria-label', function ariaLabel() {
      renderButton();

      expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
      expect(screen.getByTestId('action-icon')).toBeInTheDocument();
    });

    it('should not show tooltip by default', function hiddenByDefault() {
      renderButton();

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('tooltip timing', function tooltipTimingTests() {
    it('should not show tooltip before the show delay elapses on hover', function hoverDelay() {
      renderButton();
      const { anchor } = getAnchor();

      fireEvent.mouseEnter(anchor);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS - 1);
      });

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should show tooltip after the show delay on hover', function hoverShow() {
      renderButton();
      const { anchor } = getAnchor();

      fireEvent.mouseEnter(anchor);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
      });

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
      expect(screen.getByText('Copy response')).toBeInTheDocument();
      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-placement', 'bottom');
    });

    it('should cancel a pending tooltip when the pointer leaves before the delay', function cancelPendingShow() {
      renderButton();
      const { anchor } = getAnchor();

      fireEvent.mouseEnter(anchor);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS / 2);
      });

      fireEvent.mouseLeave(anchor);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
      });

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should hide tooltip immediately on mouse leave after it is visible', function hideOnMouseLeave() {
      renderButton();
      const { anchor } = getAnchor();

      fireEvent.mouseEnter(anchor);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
      });

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.mouseLeave(anchor);

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should show tooltip after the show delay on focus', function focusShow() {
      renderButton();
      const { button } = getAnchor();

      fireEvent.focus(button);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
      });

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('should hide tooltip on blur', function hideOnBlur() {
      renderButton();
      const { button } = getAnchor();

      fireEvent.focus(button);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
      });

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.blur(button);

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
    });

    it('should hide tooltip on click and invoke onClick', function hideOnClick() {
      const onClick = vi.fn();
      renderButton(onClick);
      const { anchor, button } = getAnchor();

      fireEvent.mouseEnter(anchor);

      act(() => {
        vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
      });

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();

      fireEvent.click(button);

      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument();
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
