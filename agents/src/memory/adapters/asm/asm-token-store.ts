import type { Message, SearchFilter } from '@gd-asm/asm-client';
import { logger } from '../../../logging/index.js';
import type { ConversationTokenStore, HistoryMessage } from '../../interfaces/conversation-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';
import type { AsmClientWrapper } from './asm-client-wrapper.js';
import { walkLinearChain } from './asm-chain.js';
import { LABEL_APP_ID, labelFilter } from './asm-conversation-store.js';

const CHARS_PER_TOKEN_ESTIMATE = 4;
const ASM_SEARCH_PAGE_SIZE = 100;
const MESSAGE_PAGE_SIZE = 500;
const MAX_MESSAGE_PAGES = 10;

export class AsmConversationTokenStore implements ConversationTokenStore {
  private lastSeenTimestamp: string | null = null;

  constructor(private readonly client: AsmClientWrapper) {}

  async getEstimatedTokensAfterMessageId(scope: WorkspaceScope, afterMessageId: string): Promise<number | null> {
    const messages = await this.getMessagesAfterMessageId(scope, afterMessageId);
    if (messages.length === 0) return null;
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
  }

  async getEstimatedTokensForApp(scope: WorkspaceScope): Promise<number> {
    const convIds = await this.searchByAppId(scope.appId);
    let totalChars = 0;
    for (const convId of convIds) {
      const messages = await this.fetchAllMessages(convId);
      for (const msg of messages) {
        const text = getTextFromContents(msg.contents);
        totalChars += text.length;
      }
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
  }

  async getMessagesAfterMessageId(scope: WorkspaceScope, afterMessageId: string): Promise<HistoryMessage[]> {
    const convIds = await this.searchByAppId(scope.appId);
    for (const convId of convIds) {
      const allMessages = await this.fetchAllMessages(convId);
      const chain = walkLinearChain(allMessages);
      const idx = chain.findIndex((m) => m.id === afterMessageId);
      if (idx === -1) continue;
      return chain.slice(idx + 1).map((m) => mapAsmToHistoryMessage(m, convId));
    }
    return [];
  }

  async getRecentMessagesForApp(scope: WorkspaceScope, limit: number): Promise<HistoryMessage[]> {
    const convIds = await this.searchByAppId(scope.appId);
    const allMessages: HistoryMessage[] = [];
    for (const convId of convIds) {
      const messages = await this.fetchAllMessages(convId);
      const chain = walkLinearChain(messages);
      for (const m of chain) {
        allMessages.push(mapAsmToHistoryMessage(m, convId));
      }
    }
    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return allMessages.slice(-limit);
  }

  async getLastMessageTimestamp(): Promise<string | null> {
    return this.lastSeenTimestamp;
  }

  recordMessageTimestamp(timestamp: Date): void {
    this.lastSeenTimestamp = timestamp.toISOString();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async fetchAllMessages(conversationId: string): Promise<Message[]> {
    const allMessages: Message[] = [];
    let before: string | undefined;

    for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
      const conv = await this.client.getConversation(conversationId, { last: MESSAGE_PAGE_SIZE, before });
      const edges = conv?.messages?.edges;
      if (!edges || edges.length === 0) break;

      for (const edge of edges) {
        if (edge?.node) allMessages.push(edge.node);
      }

      const pageInfo = conv?.messages?.pageInfo;
      if (!pageInfo?.hasPreviousPage) break;
      before = pageInfo.startCursor ?? undefined;
    }

    return allMessages;
  }

  private async searchByAppId(appId: string): Promise<string[]> {
    const filter: SearchFilter = {
      matchAll: labelFilter(LABEL_APP_ID, appId),
    };
    const resp = await this.client.searchConversations(filter, { first: ASM_SEARCH_PAGE_SIZE });
    if (resp.pageInfo?.hasNextPage) {
      logger.warn('asm.tokenStore.searchByAppId_truncated', {
        appId,
        returnedCount: resp.conversationIds.length,
        pageSize: ASM_SEARCH_PAGE_SIZE,
      });
    }
    return resp.conversationIds;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextFromContents(contents?: Message['contents']): string {
  if (!contents) return '';
  for (const c of contents) {
    if ('text' in c) return (c as { text: string }).text;
  }
  return '';
}

function mapAsmToHistoryMessage(asmMsg: Message, conversationId: string): HistoryMessage {
  const sender: 'user' | 'agent' = asmMsg.participant.type === 'USER' ? 'user' : 'agent';
  const text = getTextFromContents(asmMsg.contents);

  return {
    id: asmMsg.id,
    conversationId,
    sender,
    content: text,
    origin: sender === 'user' ? 'customer' : 'support',
    createdAt: asmMsg.messageCreatedAt instanceof Date
      ? asmMsg.messageCreatedAt
      : asmMsg.createdAt instanceof Date
        ? asmMsg.createdAt
        : new Date(asmMsg.createdAt as unknown as string),
  };
}
