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

  it('renders contact form fields and message body for the first inbound message in a contactForm conversation', () => {
    render(
      <InboxMessageBubble
        message={makeMessage({ body: 'I need help with sizing' })}
        conversation={makeConversation({
          messageType: 'contactForm',
          form: {
            type: 'contact',
            title: 'Get in Touch',
            fields: [
              { name: 'full_name', value: 'Ada Lovelace' },
              { name: 'email', value: 'ada@example.com' },
            ],
          },
        })}
        isFirstMessage={true}
      />,
    );

    expect(screen.getByText('Get in Touch')).toBeInTheDocument();
    expect(screen.getByTestId('contact-form-fields')).toBeInTheDocument();
    expect(screen.getByText('full_name')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('I need help with sizing')).toBeInTheDocument();
  });

  it('renders the contact form card and fallback body for a contactForm first message with empty body', () => {
    render(
      <InboxMessageBubble
        message={makeMessage({ body: '' })}
        conversation={makeConversation({
          messageType: 'contactForm',
          form: {
            type: 'contact',
            title: 'Contact Us',
            fields: [{ name: 'help_topic', value: 'Sizing' }],
          },
        })}
        isFirstMessage={true}
      />,
    );

    expect(screen.getByText('Contact Us')).toBeInTheDocument();
    expect(screen.getByTestId('contact-form-fields')).toBeInTheDocument();
    expect(screen.getByTestId('message-content')).toBeInTheDocument();
  });

  it('renders normal body for non-first messages in a contactForm conversation', () => {
    render(
      <InboxMessageBubble
        message={makeMessage({ body: 'follow-up message' })}
        conversation={makeConversation({
          messageType: 'contactForm',
          form: {
            type: 'contact',
            title: 'Get in Touch',
            fields: [{ name: 'email', value: 'ada@example.com' }],
          },
        })}
        isFirstMessage={false}
      />,
    );

    expect(screen.queryByTestId('contact-form-fields')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-content')).toHaveTextContent('follow-up message');
  });
});
