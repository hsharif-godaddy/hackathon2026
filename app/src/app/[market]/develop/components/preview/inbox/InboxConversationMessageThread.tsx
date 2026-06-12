'use client';

import { Conversation } from '@/types/inbox/local/conversation';
import { Message } from '@/types/inbox/local/message';
import { InboxMessageBubble } from './InboxMessageBubble';

interface InboxConversationMessageThreadProps {
  messages: Message[];
  conversation: Conversation;
}

export function InboxConversationMessageThread({
  messages,
  conversation,
}: InboxConversationMessageThreadProps) {
  const chronologicalMessages = [...messages].reverse();

  return (
    <div
      className='flex flex-1 flex-col gap-1 overflow-y-auto bg-ux-surface-base px-3 py-3'
      data-testid='conversation-message-thread'
    >
      {chronologicalMessages.map((message) => (
        <InboxMessageBubble
          key={message.id}
          message={message}
          conversation={conversation}
          isFirstMessage={message.id === chronologicalMessages[0]?.id}
        />
      ))}
    </div>
  );
}
