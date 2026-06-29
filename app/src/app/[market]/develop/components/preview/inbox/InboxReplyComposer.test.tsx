/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/tests/test-utils';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxReplyComposer } from './InboxReplyComposer';

vi.mock('@airo-ux/pattern-library/surfaces/floating-footer', () => ({
  FloatingFooter: ({ children, ...props }: { children: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner" />,
}));

const mockMutate = vi.fn();
let mockIsPending = false;

vi.mock('@/app/[market]/develop/hooks/useInbox', () => ({
  useSendInboxReply: () => ({
    mutate: mockMutate,
    get isPending() {
      return mockIsPending;
    },
  }),
}));

const defaultProps: { brandId: UuidString; conversationId: IntString } = {
  brandId: 'brand-1' as UuidString,
  conversationId: 'conv-1' as IntString,
};

describe('InboxReplyComposer', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockIsPending = false;
  });

  it('renders composer with input and send button', () => {
    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    expect(screen.getByTestId('inbox-reply-composer')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-reply-input')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-reply-send')).toBeInTheDocument();
  });

  it('calls mutate with trimmed text on button click', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onSuccess();
    });
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, '  Hello there  ');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(mockMutate).toHaveBeenCalledWith(
      { body: 'Hello there' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('calls mutate on Enter key press', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onSuccess();
    });
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');

    expect(mockMutate).toHaveBeenCalledWith(
      { body: 'Hello' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('does not call mutate on Shift+Enter', async () => {
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not call mutate when input is whitespace-only', async () => {
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, '   ');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('disables input and button when disabled prop is true', () => {
    renderWithProviders(<InboxReplyComposer {...defaultProps} disabled />);

    expect(screen.getByTestId('inbox-reply-input')).toBeDisabled();
    expect(screen.getByTestId('inbox-reply-send')).toBeDisabled();
  });

  it('disables send button when input is empty', () => {
    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    expect(screen.getByTestId('inbox-reply-send')).toBeDisabled();
  });

  it('clears input on successful send', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onSuccess();
    });
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(input).toHaveValue('');
  });

  it('shows error message on failed send and preserves text', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onError(new Error('Network error'));
    });
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(screen.getByTestId('inbox-reply-error')).toBeInTheDocument();
    expect(input).toHaveValue('Hello');
  });

  it('clears error when user types again', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onError(new Error('Network error'));
    });
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(screen.getByTestId('inbox-reply-error')).toBeInTheDocument();

    await user.type(input, ' again');
    expect(screen.queryByTestId('inbox-reply-error')).not.toBeInTheDocument();
  });

  it('does not call mutate when sending is pending via button click', async () => {
    mockIsPending = true;
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not call mutate when sending is pending via Enter key', async () => {
    mockIsPending = true;
    const user = userEvent.setup();

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('disables send button when sending is pending', () => {
    mockIsPending = true;

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    expect(screen.getByTestId('inbox-reply-send')).toBeDisabled();
  });

  it('shows spinner icon when sending is pending', () => {
    mockIsPending = true;

    renderWithProviders(<InboxReplyComposer {...defaultProps} />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });
});
