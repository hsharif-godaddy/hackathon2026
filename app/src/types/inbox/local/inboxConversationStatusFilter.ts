import { ConversationStatus } from './conversation';

export type InboxConversationStatusFilter = 'all' | Extract<ConversationStatus, 'unresolved' | 'pending' | 'resolved'>;
