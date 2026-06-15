import { ChannelIconKind, channelIconKindFor } from '@/lib/inbox/channelIcon';
import { Conversation } from '@/types/inbox/local/conversation';

const CHANNEL_LABEL_KEYS: Record<ChannelIconKind, string> = {
  guidebot: 'builder_inbox_channel_guidebot',
  contact: 'builder_inbox_channel_contactform',
  chat: 'builder_inbox_channel_chat',
};

/**
 * Returns the i18n key for the conversation's channel-type label. Callers are
 * responsible for translating it via `t()` — this is a pure helper and cannot
 * use the translation hook.
 */
export function conversationTypeLabel(conversation: Conversation): string {
  return CHANNEL_LABEL_KEYS[channelIconKindFor(conversation)];
}
