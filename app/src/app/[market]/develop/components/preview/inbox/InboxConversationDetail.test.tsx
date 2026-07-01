/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

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

const mockUseInboxConversation = vi.hoisted(() => vi.fn());

vi.mock('@/app/[market]/develop/hooks/useInbox', () => ({
  useInboxConversationMessages: () => ({
    isLoading: false,
    isError: false,
    error: null,
    data: { messages: [] },
  }),
  useInboxConversation: (...args: unknown[]) => mockUseInboxConversation(...args),
  useSendInboxReply: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('./InboxConversationDetailHeader', () => ({
  InboxConversationDetailHeader: () => <div data-testid="stub-header" />,
}));

vi.mock('./InboxConversationMessageThread', () => ({
  InboxConversationMessageThread: () => <div data-testid="stub-thread" />,
}));

vi.mock('./InboxReplyComposer', () => ({
  InboxReplyComposer: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="stub-composer" data-disabled={disabled} />
  ),
}));

describe('InboxConversationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseInboxConversation.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: { id: 'conv-1', originalChannel: 'WebChat', category: { id: 1, name: 'Chat', slug: 'chat', type: 'WebChat' }, channel: 'email', customer: { name: 'Test' } },
    });
  });

  it('renders skeleton while conversation is loading', () => {
    mockUseInboxConversation.mockReturnValue({
      isLoading: true,
      isError: false,
      error: null,
      data: undefined,
    });

    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    expect(screen.getByTestId('inbox-detail-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-header')).not.toBeInTheDocument();
  });

  it('renders header, thread, and composer', () => {
    renderWithProviders(
      <InboxConversationDetail
        conversationId="conv-1"
        brandId="brand-1"
        onBack={vi.fn()}
        consumeEntryRef={() => null}
      />,
    );

    expect(screen.getByTestId('stub-header')).toBeInTheDocument();
    expect(screen.getByTestId('stub-thread')).toBeInTheDocument();
    expect(screen.getByTestId('stub-composer')).toBeInTheDocument();
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

    expect(screen.getByTestId('stub-composer')).toHaveAttribute('data-disabled', 'true');
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
