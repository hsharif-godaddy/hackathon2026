import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { Conversation } from '@/types/inbox/local/conversation';

/**
 * Returns the i18n key for the conversation's channel-type label. Callers are
 * responsible for translating it via `t()` — this is a pure helper and cannot
 * use the translation hook.
 */
export function conversationTypeLabel(conversation: Conversation): string {
  if (isGuideBotConversation(conversation)) {
    return 'builder_inbox_channel_guidebot';
  }
  if (conversation.messageType === 'contactForm' || conversation.form?.title) {
    return 'builder_inbox_channel_contactform';
  }
  return 'builder_inbox_channel_chat';
}
