import { Conversation } from '@/types/inbox/local/conversation';

export function isGuideBotConversation(conversation: Conversation): boolean {
  return conversation.originalChannel === 'GuideBot' || conversation.category.type === 'GuideBot';
}
