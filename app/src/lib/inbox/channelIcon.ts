import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { Conversation } from '@/types/inbox/local/conversation';

export type ChannelIconKind = 'chat' | 'contact' | 'guidebot';

export function channelIconKindFor(conversation: Conversation): ChannelIconKind {
  if (isGuideBotConversation(conversation)) {
    return 'guidebot';
  }
  if (conversation.messageType === 'contactForm' || conversation.form?.title) {
    return 'contact';
  }
  return 'chat';
}
