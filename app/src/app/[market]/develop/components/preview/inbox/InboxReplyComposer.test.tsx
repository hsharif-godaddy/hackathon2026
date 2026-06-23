/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/tests/test-utils';
import { InboxReplyComposer } from './InboxReplyComposer';

vi.mock('@airo-ux/pattern-library/surfaces/floating-footer', () => ({
  FloatingFooter: ({ children, ...props }: { children: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

describe('InboxReplyComposer', () => {
  it('renders composer with input and send button', () => {
    renderWithProviders(
      <InboxReplyComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId('inbox-reply-composer')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-reply-input')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-reply-send')).toBeInTheDocument();
  });

  it('calls onSend with trimmed text on button click', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <InboxReplyComposer
        value="  Hello there  "
        onChange={vi.fn()}
        onSend={onSend}
      />,
    );

    await user.click(screen.getByTestId('inbox-reply-send'));
    expect(onSend).toHaveBeenCalledWith('Hello there');
  });

  it('calls onSend on Enter key press', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByTestId('inbox-reply-input');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('does not call onSend on Shift+Enter', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByTestId('inbox-reply-input');
    await user.click(input);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not call onSend when value is whitespace-only', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <InboxReplyComposer
        value="   "
        onChange={vi.fn()}
        onSend={onSend}
      />,
    );

    await user.click(screen.getByTestId('inbox-reply-send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables input and button when disabled prop is true', () => {
    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByTestId('inbox-reply-input')).toBeDisabled();
    expect(screen.getByTestId('inbox-reply-send')).toBeDisabled();
  });

  it('disables send button when value is empty', () => {
    renderWithProviders(
      <InboxReplyComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId('inbox-reply-send')).toBeDisabled();
  });

  it('displays error message when error prop is true', () => {
    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        error
      />,
    );

    expect(screen.getByTestId('inbox-reply-error')).toBeInTheDocument();
  });

  it('does not display error message when error prop is false', () => {
    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('inbox-reply-error')).not.toBeInTheDocument();
  });

  it('keeps textarea enabled when sending is true', () => {
    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        sending
      />,
    );

    expect(screen.getByTestId('inbox-reply-input')).not.toBeDisabled();
  });

  it('disables send button when sending is true', () => {
    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        sending
      />,
    );

    expect(screen.getByTestId('inbox-reply-send')).toBeDisabled();
  });

  it('does not call onSend when sending is true', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <InboxReplyComposer
        value="Hello"
        onChange={vi.fn()}
        onSend={onSend}
        sending
      />,
    );

    await user.click(screen.getByTestId('inbox-reply-send'));
    expect(onSend).not.toHaveBeenCalled();

    const input = screen.getByTestId('inbox-reply-input');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });
});
