/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Conversation } from '@/types/inbox/local/conversation';
import { Message } from '@/types/inbox/local/message';
import { InboxMessageBubble } from './InboxMessageBubble';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/time', () => ({
  timeAgo: () => ({ key: 'builder_time_now', values: {} }),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    body: 'hello there',
    isInbound: true,
    createdAt: '2026-06-09T00:00:00.000Z',
    user: { name: 'Ada Lovelace' },
    ...overrides,
  } as unknown as Message;
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  // Default to two participants so sender labels render; the bubble derives
  // singleParticipant from c2.length and the contact-form seam from messageType.
  return {
    id: 'c1',
    messageType: 'chat',
    c2: [{ name: 'Ada Lovelace' }, { name: 'Biz Agent' }],
    ...overrides,
  } as unknown as Conversation;
}

describe('InboxMessageBubble', () => {
  it('renders an inbound message left-aligned with a sender label', () => {
    render(
      <InboxMessageBubble
        message={makeMessage()}
        conversation={makeConversation()}
      />,
    );

    expect(screen.getByTestId('message-bubble')).toHaveClass('justify-start');
    expect(screen.getByTestId('message-sender-label')).toHaveTextContent('Ada');
    expect(screen.getByTestId('message-content')).toHaveTextContent('hello there');
  });

  it('omits the sender label for single-participant inbound rows', () => {
    render(
      <InboxMessageBubble
        message={makeMessage()}
        conversation={makeConversation({ c2: [{ name: 'Ada Lovelace' }] as Conversation['c2'] })}
      />,
    );

    expect(screen.getByTestId('message-bubble')).toHaveClass('justify-start');
    expect(screen.queryByTestId('message-sender-label')).not.toBeInTheDocument();
  });

  it('renders an outbound message right-aligned without a sender label', () => {
    render(
      <InboxMessageBubble
        message={makeMessage({ isInbound: false })}
        conversation={makeConversation()}
      />,
    );

    expect(screen.getByTestId('message-bubble')).toHaveClass('justify-end');
    expect(screen.queryByTestId('message-sender-label')).not.toBeInTheDocument();
  });

  it('falls back to placeholder text when the body is empty', () => {
    render(
      <InboxMessageBubble
        message={makeMessage({ body: '' })}
        conversation={makeConversation()}
      />,
    );

    expect(screen.getByTestId('message-content')).toHaveTextContent(
      'builder_inbox_message_no_content',
    );
  });

  it('renders the contact-form seam for an inbound contactForm conversation', () => {
    render(
      <InboxMessageBubble
        message={makeMessage()}
        conversation={makeConversation({ messageType: 'contactForm' })}
      />,
    );

    expect(screen.getByText('Contact Form')).toBeInTheDocument();
    expect(screen.queryByTestId('message-content')).not.toBeInTheDocument();
  });
});
