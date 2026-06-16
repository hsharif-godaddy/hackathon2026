/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Conversation } from '@/types/inbox/local/conversation';
import { Message } from '@/types/inbox/local/message';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('framer-motion', () => ({
  useInView: () => false,
}));

vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: vi.fn() },
}));

const mockUseInfiniteInboxConversationMessages = vi.fn();

vi.mock('@/app/[market]/develop/hooks/useInbox', () => ({
  useInfiniteInboxConversationMessages: (...args: unknown[]) =>
    mockUseInfiniteInboxConversationMessages(...args),
}));

let capturedBubbleProps: Array<{ messageId: string; isFirstMessage: boolean }> = [];

vi.mock('./InboxMessageBubble', () => ({
  InboxMessageBubble: ({ message, isFirstMessage }: { message: Message; isFirstMessage?: boolean }) => {
    capturedBubbleProps.push({ messageId: message.id, isFirstMessage: !!isFirstMessage });
    return <div data-testid={`bubble-${message.id}`} data-first={isFirstMessage} />;
  },
}));

import { InboxConversationMessageThread } from './InboxConversationMessageThread';

function makeMessage(id: string, createdAt: string): Message {
  return {
    id,
    body: `Message ${id}`,
    isInbound: true,
    createdAt,
    user: { name: 'Test User' },
  } as unknown as Message;
}

function makeConversation(): Conversation {
  return {
    id: 'conv-1',
    messageType: 'chat',
    c2: [{ name: 'User' }],
  } as unknown as Conversation;
}

function mockInfiniteQuery(
  pages: Array<{ messages: Message[] }>,
  hasNextPage: boolean,
): void {
  mockUseInfiniteInboxConversationMessages.mockReturnValue({
    data: { pages, pageParams: [] },
    fetchNextPage: vi.fn(),
    hasNextPage,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    error: null,
  });
}

describe('InboxConversationMessageThread', () => {
  beforeEach(() => {
    capturedBubbleProps = [];
  });

  it('renders messages in the order returned by the API (newest first for flex-col-reverse)', () => {
    const messages = [
      makeMessage('newest', '2026-06-10T12:00:00.000Z'),
      makeMessage('middle', '2026-06-10T11:00:00.000Z'),
      makeMessage('oldest', '2026-06-10T10:00:00.000Z'),
    ];
    mockInfiniteQuery([{ messages }], false);

    render(
      <InboxConversationMessageThread
        conversationId='1'
        brandId='brand-1'
        conversation={makeConversation()}
      />,
    );

    const bubbles = screen.getAllByTestId(/^bubble-/);
    expect(bubbles[0]).toHaveAttribute('data-testid', 'bubble-newest');
    expect(bubbles[1]).toHaveAttribute('data-testid', 'bubble-middle');
    expect(bubbles[2]).toHaveAttribute('data-testid', 'bubble-oldest');
  });

  it('marks the last message as isFirstMessage when all pages are loaded', () => {
    const messages = [
      makeMessage('newest', '2026-06-10T12:00:00.000Z'),
      makeMessage('oldest', '2026-06-10T10:00:00.000Z'),
    ];
    mockInfiniteQuery([{ messages }], false);

    render(
      <InboxConversationMessageThread
        conversationId='1'
        brandId='brand-1'
        conversation={makeConversation()}
      />,
    );

    const newestProps = capturedBubbleProps.find((p) => p.messageId === 'newest');
    const oldestProps = capturedBubbleProps.find((p) => p.messageId === 'oldest');
    expect(newestProps?.isFirstMessage).toBe(false);
    expect(oldestProps?.isFirstMessage).toBe(true);
  });

  it('does NOT mark any message as isFirstMessage when more pages remain', () => {
    const messages = [
      makeMessage('newest', '2026-06-10T12:00:00.000Z'),
      makeMessage('page1-oldest', '2026-06-10T10:00:00.000Z'),
    ];
    mockInfiniteQuery([{ messages }], true);

    render(
      <InboxConversationMessageThread
        conversationId='1'
        brandId='brand-1'
        conversation={makeConversation()}
      />,
    );

    const allFirst = capturedBubbleProps.filter((p) => p.isFirstMessage);
    expect(allFirst).toHaveLength(0);
  });

  it('marks the correct message across multiple loaded pages when fully paginated', () => {
    const page1 = [
      makeMessage('newest', '2026-06-10T12:00:00.000Z'),
      makeMessage('mid', '2026-06-10T11:00:00.000Z'),
    ];
    const page2 = [
      makeMessage('older', '2026-06-10T10:00:00.000Z'),
      makeMessage('very-first', '2026-06-10T09:00:00.000Z'),
    ];
    mockInfiniteQuery([{ messages: page1 }, { messages: page2 }], false);

    render(
      <InboxConversationMessageThread
        conversationId='1'
        brandId='brand-1'
        conversation={makeConversation()}
      />,
    );

    const firstMarked = capturedBubbleProps.filter((p) => p.isFirstMessage);
    expect(firstMarked).toHaveLength(1);
    expect(firstMarked[0].messageId).toBe('very-first');
  });

  it('does not mark last message of page 1 when page 2 has not loaded yet', () => {
    const page1 = [
      makeMessage('newest', '2026-06-10T12:00:00.000Z'),
      makeMessage('page1-last', '2026-06-10T10:00:00.000Z'),
    ];
    mockInfiniteQuery([{ messages: page1 }], true);

    render(
      <InboxConversationMessageThread
        conversationId='1'
        brandId='brand-1'
        conversation={makeConversation()}
      />,
    );

    const page1LastProps = capturedBubbleProps.find((p) => p.messageId === 'page1-last');
    expect(page1LastProps?.isFirstMessage).toBe(false);
  });
});
