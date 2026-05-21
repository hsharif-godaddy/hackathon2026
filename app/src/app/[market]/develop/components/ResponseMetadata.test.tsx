/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ResponseMetadata from './ResponseMetadata';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: any, fallback?: string) => fallback || key,
}))

describe('ResponseMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    renderWithProviders(<ResponseMetadata duration={1000} content="Test content" />);

    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();
  });

  it('outer element should be a div, not a button (accessibility fix)', () => {
    renderWithProviders(<ResponseMetadata duration={1000} content="Test content" />);
    const el = screen.getByTestId('response-metadata');
    expect(el.tagName).toBe('DIV');
  });

  it('should display completed text', () => {
    renderWithProviders(<ResponseMetadata duration={500} content="Test" />);

    expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();
  });

  it('should show duration on hover', async () => {
    const { user } = renderWithProviders(<ResponseMetadata duration={2500} content="Test" />);

    const container = screen.getByTestId('response-metadata');

    // Duration should not be visible initially
    expect(screen.queryByText(/builder_chat_in_duration/i)).not.toBeInTheDocument();

    // Hover over the container
    await user.hover(container);

    // Duration should now be visible
    await waitFor(() => {
      expect(screen.getByText(/builder_chat_in_duration/i)).toBeInTheDocument();
    });
  });

  it('should hide duration on mouse leave', async () => {
    const { user } = renderWithProviders(<ResponseMetadata duration={2500} content="Test" />);

    const container = screen.getByTestId('response-metadata');

    // Hover to show duration
    await user.hover(container);
    await waitFor(() => {
      expect(screen.getByText(/builder_chat_in_duration/i)).toBeInTheDocument();
    });

    // Unhover to hide duration
    await user.unhover(container);
    await waitFor(() => {
      expect(screen.queryByText(/builder_chat_in_duration/i)).not.toBeInTheDocument();
    });
  });

  it('should show copy button on hover', async () => {
    const { user } = renderWithProviders(<ResponseMetadata duration={1000} content="Test content" />);

    const container = screen.getByTestId('response-metadata');
    await user.hover(container);

    await waitFor(() => {
      expect(screen.getByTitle('builder_chat_copy_clipboard')).toBeInTheDocument();
    });
  });

  it('should copy content to clipboard when copy button clicked', async () => {
    const content = 'Content to copy';
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');

    const { user } = renderWithProviders(
      <ResponseMetadata duration={1000} content={content} />
    );

    const container = screen.getByTestId('response-metadata');
    await user.hover(container);

    await waitFor(() => {
      expect(screen.getByTitle('builder_chat_copy_clipboard')).toBeInTheDocument();
    });

    const copyButton = screen.getByTitle('builder_chat_copy_clipboard');
    await user.click(copyButton);

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(content);
    });
  });

  it('should show check icon after successful copy on hover', async () => {
    const { user, container } = renderWithProviders(
      <ResponseMetadata duration={1000} content="Test" />
    );

    const metadata = screen.getByTestId('response-metadata');
    await user.hover(metadata);

    await waitFor(() => {
      expect(screen.getByTitle('builder_chat_copy_clipboard')).toBeInTheDocument();
    });

    const copyButton = screen.getByTitle('builder_chat_copy_clipboard');
    await user.click(copyButton);

    await waitFor(() => {
      // Check icon should be visible after copy when hovering
      const icons = container.querySelectorAll('svg');
      expect(icons.length).toBeGreaterThan(1); // OkIcon + CheckIcon
    });
  });

  it('should reset copied state on mouse leave', async () => {
    const { user } = renderWithProviders(
      <ResponseMetadata duration={1000} content="Test" />
    );

    const metadata = screen.getByTestId('response-metadata');

    // Hover and click copy
    await user.hover(metadata);
    await waitFor(() => {
      expect(screen.getByTitle('builder_chat_copy_clipboard')).toBeInTheDocument();
    });
    await user.click(screen.getByTitle('builder_chat_copy_clipboard'));

    // Leave the container
    await user.unhover(metadata);

    // Hover again - copy button should reappear
    await user.hover(metadata);

    await waitFor(() => {
      expect(screen.getByTitle('builder_chat_copy_clipboard')).toBeInTheDocument();
    });
  });

  it.skip('should revert to copy icon after 5 seconds', async () => {
    // This test is skipped because fake timers don't play well with user-event
    // The component behavior is tested in other tests
  });

  it('should render without crashing with different durations', () => {
    const { rerender } = renderWithProviders(<ResponseMetadata duration={999} content="Test" />);
    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();

    rerender(<ResponseMetadata duration={1000} content="Test" />);
    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();

    rerender(<ResponseMetadata duration={59999} content="Test" />);
    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();

    rerender(<ResponseMetadata duration={60000} content="Test" />);
    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();
  });

  it('should handle different content strings', () => {
    const content1 = 'First content';
    const content2 = 'Second content with more text';

    const { rerender } = renderWithProviders(
      <ResponseMetadata duration={1000} content={content1} />
    );

    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();

    rerender(<ResponseMetadata duration={1000} content={content2} />);
    expect(screen.getByTestId('response-metadata')).toBeInTheDocument();
  });

  describe('onRestore', () => {
    // The restore button sits next to the copy button when onRestore is
    // provided. Unlike the copy button it is not gated on hover — it is the
    // primary affordance for the per-prompt restore action. Title is the
    // `t('builder_chat_restore', …, 'Restore')` fallback resolved by the
    // mocked useTranslations above.
    const RESTORE_TITLE = 'Restore';

    it('does not render a restore button when onRestore is not provided', async () => {
      const { user } = renderWithProviders(<ResponseMetadata duration={1000} content="Test" />);

      const container = screen.getByTestId('response-metadata');
      await user.hover(container);

      await waitFor(() => {
        expect(screen.getByTitle('builder_chat_copy_clipboard')).toBeInTheDocument();
      });
      expect(screen.queryByTitle(RESTORE_TITLE)).not.toBeInTheDocument();
    });

    it('renders the restore button when onRestore is provided', () => {
      const onRestore = vi.fn();
      renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" onRestore={onRestore} />
      );

      expect(screen.getByTitle(RESTORE_TITLE)).toBeInTheDocument();
    });

    it('invokes onRestore when the restore button is clicked', async () => {
      const onRestore = vi.fn();
      const { user } = renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" onRestore={onRestore} />
      );

      await user.click(screen.getByTitle(RESTORE_TITLE));
      expect(onRestore).toHaveBeenCalledTimes(1);
    });
  });

  describe('onUndo', () => {
    // The undo button takes the same slot as the restore button on the
    // most recent completed assistant turn. Title matches the action — it
    // discards the changes the agent just made by either stashing
    // uncommitted work or rewinding to the prior commit.
    const UNDO_TITLE = 'Undo';
    const RESTORE_TITLE = 'Restore';

    it('renders the undo button when onUndo is provided', () => {
      const onUndo = vi.fn();
      renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" onUndo={onUndo} />
      );

      expect(screen.getByTitle(UNDO_TITLE)).toBeInTheDocument();
    });

    it('invokes onUndo when the undo button is clicked', async () => {
      const onUndo = vi.fn();
      const { user } = renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" onUndo={onUndo} />
      );

      await user.click(screen.getByTitle(UNDO_TITLE));
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it('renders only the undo button when both onUndo and onRestore are provided', () => {
      // Defensive: callers are expected to pass at most one, but undo wins
      // if both arrive — the latest completed turn shouldn't double up.
      const onUndo = vi.fn();
      const onRestore = vi.fn();
      renderWithProviders(
        <ResponseMetadata
          duration={1000}
          content="Test"
          onUndo={onUndo}
          onRestore={onRestore}
        />
      );

      expect(screen.getByTitle(UNDO_TITLE)).toBeInTheDocument();
      expect(screen.queryByTitle(RESTORE_TITLE)).not.toBeInTheDocument();
    });
  });

  describe('usedFreeGrants', () => {
    it('should render free grants text when usedFreeGrants is true', () => {
      renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" usedFreeGrants={true} />
      );

      expect(screen.getByText(/builder_chat_completed_free/i)).toBeInTheDocument();
    });

    it('should render regular completed text when usedFreeGrants is false', () => {
      renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" usedFreeGrants={false} />
      );

      expect(screen.getByText(/builder_chat_completed/i)).toBeInTheDocument();
      expect(screen.queryByText(/builder_chat_completed_free/i)).not.toBeInTheDocument();
    });

    it('should apply success color class when usedFreeGrants is true', () => {
      renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" usedFreeGrants={true} />
      );

      const el = screen.getByTestId('response-metadata');
      expect(el).toHaveClass('text-intents-ux-feedbackHighContrastSuccess-feedbackColor');
      expect(el).not.toHaveClass('text-foreground/50');
    });

    it('should apply default color class when usedFreeGrants is false', () => {
      renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" usedFreeGrants={false} />
      );

      const el = screen.getByTestId('response-metadata');
      expect(el).toHaveClass('text-foreground/50');
      expect(el).not.toHaveClass('text-intents-ux-feedbackHighContrastSuccess-feedbackColor');
    });

    it('should not apply hover text color change when usedFreeGrants is true', () => {
      const { container } = renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" usedFreeGrants={true} />
      );

      // The inner div should not have group-hover:text-foreground class
      const innerDiv = container.querySelector('.flex.gap-0\\.5');
      expect(innerDiv).not.toHaveClass('group-hover:text-foreground');
    });

    it('should apply hover text color change when usedFreeGrants is false', () => {
      const { container } = renderWithProviders(
        <ResponseMetadata duration={1000} content="Test" usedFreeGrants={false} />
      );

      // The inner div should have group-hover:text-foreground class
      const innerDiv = container.querySelector('.flex.gap-0\\.5');
      expect(innerDiv).toHaveClass('group-hover:text-foreground');
    });
  });

});
