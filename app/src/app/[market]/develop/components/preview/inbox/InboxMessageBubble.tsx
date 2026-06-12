'use client';

import { useTranslations } from '@/hooks/useTranslations';
import { Conversation } from '@/types/inbox/local/conversation';
import { Message } from '@/types/inbox/local/message';
import { timeAgo } from '@/utils/time';
import { CUSTOMER_BUBBLE_CLASS, SENT_BUBBLE_CLASS } from './bubbleStyles';
import { ContactFormMessageContent } from './ContactFormMessageContent';

interface InboxMessageBubbleProps {
  message: Message;
  conversation: Conversation;
  isFirstMessage?: boolean;
}

const MESSAGE_BODY_CLASS =
  'text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-ux-text-primary';

function firstName(fullName: string): string {
  const [first] = fullName.trim().split(/\s+/).filter(Boolean);
  return first ?? fullName;
}

function MessageTimestamp({
  value,
  side,
}: {
  value: string;
  side: 'left' | 'right';
}) {
  return (
    <span
      className={`shrink-0 self-center whitespace-nowrap text-xs leading-none text-ux-text-tertiary opacity-0 transition-opacity group-hover/message-row:opacity-100 group-focus-within/message-row:opacity-100 ${side === 'right' ? 'pl-px' : 'pr-px'}`}
      data-testid='message-timestamp'
    >
      {value}
    </span>
  );
}

function MessageBubbleBody({
  body,
  className,
}: {
  body: string;
  className: string;
}) {
  return (
    <div className={className} data-testid='message-content'>
      <p className={MESSAGE_BODY_CLASS}>{body}</p>
    </div>
  );
}

export function InboxMessageBubble({
  message,
  conversation,
  isFirstMessage = false,
}: InboxMessageBubbleProps) {
  const { body, isInbound, createdAt } = message;
  const t = useTranslations();
  const relativeTime = timeAgo(createdAt);
  const timestamp = t(relativeTime.key, relativeTime.values);
  const displayBody = body || t('builder_inbox_message_no_content');
  const singleParticipant = conversation.c2.length === 1;

  const isContactFormFirstMessage =
    isFirstMessage && isInbound && conversation.messageType === 'contactForm';

  const contactFormCard =
    isContactFormFirstMessage && conversation.form?.fields.length ? (
      <ContactFormMessageContent form={conversation.form} />
    ) : null;

  const bubble = (
    <MessageBubbleBody
      body={displayBody}
      className={isInbound ? CUSTOMER_BUBBLE_CLASS : SENT_BUBBLE_CLASS}
    />
  );

  const timestampEl = (
    <MessageTimestamp value={timestamp} side={isInbound ? 'right' : 'left'} />
  );

  const bubbleRow = (
    <div className='flex items-center gap-1.5'>
      {isInbound ? (
        <>
          {bubble}
          {timestampEl}
        </>
      ) : (
        <>
          {timestampEl}
          {bubble}
        </>
      )}
    </div>
  );

  const showSenderLabel = isInbound && !singleParticipant;

  return (
    <div
      className={`group/message-row flex w-full ${isInbound ? 'justify-start' : 'justify-end'}`}
      data-testid='message-bubble'
    >
      {showSenderLabel ? (
        <div className='flex min-w-0 max-w-[80%] flex-col items-start'>
          <span
            className='mb-0.5 px-1 text-xs font-medium text-ux-text-secondary'
            data-testid='message-sender-label'
          >
            {firstName(message.user.name)}
          </span>
          {contactFormCard}
          {bubbleRow}
        </div>
      ) : contactFormCard ? (
        <div className='flex max-w-[80%] flex-col items-start'>
          {contactFormCard}
          {bubbleRow}
        </div>
      ) : (
        <div className='max-w-[80%]'>
          {bubbleRow}
        </div>
      )}
    </div>
  );
}
