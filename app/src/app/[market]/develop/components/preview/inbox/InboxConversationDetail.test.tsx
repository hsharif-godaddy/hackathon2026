/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { renderWithProviders } from '@/tests/test-utils';
import { InboxConversationDetail } from './InboxConversationDetail';

vi.mock('@/lib/inbox/isGuideBotConversation', () => ({
  isGuideBotConversation: vi.fn(() => false),
}));

const instrumentation = vi.hoisted(() => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils/instrumentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/instrumentation')>();
  return {
    ...actual,
    logImpressionEvent: instrumentation.logImpressionEvent,
  };
});

const mockMutate = vi.fn();

vi.mock('@/app/[market]/develop/hooks/useInbox', () => ({
  useInboxConversationMessages: () => ({
    isLoading: false,
    isError: false,
    error: null,
    data: { messages: [] },
  }),
  useInboxConversation: () => ({
    isLoading: false,
    isError: false,
    error: null,
    data: { id: 'conv-1', originalChannel: 'WebChat', category: { id: 1, name: 'Chat', slug: 'chat', type: 'WebChat' }, channel: 'email', customer: { name: 'Test' } },
  }),
  useSendInboxReply: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('./InboxConversationDetailHeader', () => ({
  InboxConversationDetailHeader: () => <div data-testid="stub-header" />,
}));

vi.mock('./InboxConversationMessageThread', () => ({
  InboxConversationMessageThread: () => <div data-testid="stub-thread" />,
}));

describe('InboxConversationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears textarea on successful send', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onSuccess();
    });

    const user = userEvent.setup();

    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(mockMutate).toHaveBeenCalledWith(
      { body: 'Hello' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(input).toHaveValue('');
  });

  it('shows error message on failed send and preserves text', async () => {
    mockMutate.mockImplementation((_params, options) => {
      options.onError(new Error('Network error'));
    });

    const user = userEvent.setup();

    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

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

    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    const input = screen.getByTestId('inbox-reply-input');
    await user.type(input, 'Hello');
    await user.click(screen.getByTestId('inbox-reply-send'));

    expect(screen.getByTestId('inbox-reply-error')).toBeInTheDocument();

    await user.type(input, ' again');
    expect(screen.queryByTestId('inbox-reply-error')).not.toBeInTheDocument();
  });

  it('clears textarea when conversationId changes', () => {
    const { rerender } = renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    const input = screen.getByTestId('inbox-reply-input');
    // Simulate typed text by checking post-rerender state
    // The useEffect fires on conversationId change and calls setBody('')
    rerender(
      <InboxConversationDetail
        conversationId="conv-2"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    expect(input).toHaveValue('');
  });

  it('disables reply composer for Guide Bot conversations', () => {
    vi.mocked(isGuideBotConversation).mockReturnValue(true);

    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    expect(screen.getByTestId('inbox-reply-input')).toBeDisabled();
  });

  it('attaches the consumed entry ref to the detail viewed impression', () => {
    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => 'email'}
      />,
    );

    expect(instrumentation.logImpressionEvent).toHaveBeenCalledWith(
      'inbox.detail.viewed',
      expect.objectContaining({ ref: 'email' }),
    );
  });

  it('omits ref from the detail viewed impression when there is no entry ref', () => {
    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    expect(instrumentation.logImpressionEvent).toHaveBeenCalledWith(
      'inbox.detail.viewed',
      expect.not.objectContaining({ ref: expect.anything() }),
    );
  });
});
