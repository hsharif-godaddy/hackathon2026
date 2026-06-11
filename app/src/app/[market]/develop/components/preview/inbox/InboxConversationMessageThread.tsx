'use client';

// import { isContactFormConversation } from '@/lib/inbox/isContactFormConversation';
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
  // const renderContactFormSubmission = isContactFormConversation(conversation)
  //   && Boolean(conversation.form?.form.length);

  return (
    <div
      className='flex flex-1 flex-col gap-1 overflow-y-auto bg-ux-surface-base px-3 py-3'
      data-testid='conversation-message-thread'
    >
      {messages.map((message) => (
        <InboxMessageBubble
          key={message.id}
          message={message}
          conversation={conversation}
        />
      ))}
    </div>
  );
}
