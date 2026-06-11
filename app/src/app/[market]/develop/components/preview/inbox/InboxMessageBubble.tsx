'use client';

import { useTranslations } from '@/hooks/useTranslations';
import { Conversation } from '@/types/inbox/local/conversation';
import { Message } from '@/types/inbox/local/message';
import { timeAgo } from '@/utils/time';

interface InboxMessageBubbleProps {
  message: Message;
  conversation: Conversation;
}

const BUBBLE_BASE_CLASS = 'rounded-lg px-2 py-1.5 my-0.5';

/** Matches StreamingMessage user role bubble (getMessageClasses). */
const SENT_BUBBLE_CLASS = `${BUBBLE_BASE_CLASS} border bg-intents-ux-actionHovered-backgroundColor`;

/** Same size/radius as sent; box surface shows it is from the customer. */
const CUSTOMER_BUBBLE_CLASS = `${BUBBLE_BASE_CLASS} border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor`;

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
}: InboxMessageBubbleProps) {
  const { body, isInbound, createdAt } = message;
  const t = useTranslations();
  const relativeTime = timeAgo(createdAt);
  const timestamp = t(relativeTime.key, relativeTime.values);
  const displayBody = body || t('builder_inbox_message_no_content');
  const singleParticipant = conversation.c2.length === 1;

  // Inbound (customer) sits left with the timestamp to its right; outbound
  // (business) sits right with the timestamp to its left.
  const bubble =
    isInbound && conversation.messageType === 'contactForm' ? (
      // TODO: <ContactFormMessageContent form={conversation.form} />
      <div>Contact Form</div>
    ) : (
      <MessageBubbleBody
        body={displayBody}
        className={isInbound ? CUSTOMER_BUBBLE_CLASS : SENT_BUBBLE_CLASS}
      />
    );

  const timestampEl = (
    <MessageTimestamp value={timestamp} side={isInbound ? 'right' : 'left'} />
  );

  const bubbleRow = (
    <div className='flex max-w-full items-center gap-1.5'>
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
        <div className='flex min-w-0 max-w-full flex-col items-start'>
          <span
            className='mb-0.5 px-1 text-xs font-medium text-ux-text-secondary'
            data-testid='message-sender-label'
          >
            {firstName(message.user.name)}
          </span>
          {bubbleRow}
        </div>
      ) : (
        bubbleRow
      )}
    </div>
  );
}
