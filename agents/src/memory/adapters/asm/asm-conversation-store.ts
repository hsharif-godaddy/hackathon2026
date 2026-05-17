import { randomUUID } from 'node:crypto';
import { logger } from '../../../logging/index.js';
import type { Conversation } from '../../../database/schema.js';
import type { ConversationLifecycleStore } from '../../interfaces/conversation-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';
import { AsmClient } from './asm-client.js';
import type { AsmConversation, AsmSearchFilter } from './asm-types.js';
import { LABEL_APP_ID, LABEL_CUSTOMER_ID, LABEL_AGENT_ID, LABEL_TITLE, labelFilter } from './asm-types.js';

const ASM_SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 5;
const ASM_ACCESS_GROUP = 'airo-app-builder';
const ASM_RETENTION_DAYS = 730;

export class AsmConversationLifecycleStore implements ConversationLifecycleStore {
  constructor(private readonly client: AsmClient, private readonly serviceId: string) {}

  async create(scope: WorkspaceScope, agentId: string, title?: string, id?: string): Promise<Conversation> {
    const conversationId = id ?? randomUUID();
    const labels: Record<string, unknown> = {
      [LABEL_APP_ID]: scope.appId,
      [LABEL_AGENT_ID]: agentId,
    };
    if (scope.kind === 'resolved') {
      labels[LABEL_CUSTOMER_ID] = scope.customerId;
    }
    if (title) {
      labels[LABEL_TITLE] = title;
    }

    await this.client.createConversation({
      id: conversationId,
      labels,
      context: {},
      participants: [
        { withSystem: { id: this.serviceId } },
      ],
      messages: [],
      enrichmentStrategy: { techniques: ['TITLE_DESCRIPTION'] },
      retentionPolicy: { interval: 'DAY', value: ASM_RETENTION_DAYS },
      acl: [
        { principal: ASM_ACCESS_GROUP, scopes: ['READ', 'WRITE'], type: 'ACCESS_GROUP' },
      ],
    });

    return {
      id: conversationId,
      appId: scope.appId,
      agentId,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getById(conversationId: string): Promise<Conversation | null> {
    const conv = await this.client.getConversation(conversationId, { first: 0 });
    if (!conv || conv.status === 'CLOSED') return null;
    return mapToConversation(conv);
  }

  async findByIds(conversationIds: string[]): Promise<Conversation[]> {
    if (conversationIds.length === 0) return [];

    const results = await Promise.allSettled(
      conversationIds.map((id) => this.getById(id))
    );
    const conversations: Conversation[] = [];
    let failedCount = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        failedCount++;
        logger.warn('asm.conversation.findByIds_partial_failure', {
          conversationId: conversationIds[i],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        continue;
      }
      if (result.value != null) {
        conversations.push(result.value);
      }
    }
    if (failedCount === conversationIds.length) {
      throw new Error(
        `All ${failedCount} conversation lookups failed — ASM may be unavailable`
      );
    }
    if (failedCount > 0) {
      logger.warn('asm.conversation.findByIds_degraded', {
        requested: conversationIds.length,
        returned: conversations.length,
        failed: failedCount,
      });
    }
    return conversations;
  }

  async getByAppId(scope: WorkspaceScope): Promise<Conversation[]> {
    const ids = await this.searchByAppId(scope.appId);
    if (ids.length === 0) return [];
    return this.findByIds(ids);
  }

  async getLatestForApp(scope: WorkspaceScope): Promise<Conversation | null> {
    const ids = await this.searchByAppId(scope.appId, 5);
    for (const id of ids) {
      const conv = await this.getById(id);
      if (conv) return conv;
    }
    return null;
  }

  async findByAppAndAgent(scope: WorkspaceScope, agentId: string): Promise<Conversation[]> {
    const filter: AsmSearchFilter = {
      matchAll: [
        ...labelFilter(LABEL_APP_ID, scope.appId),
        ...labelFilter(LABEL_AGENT_ID, agentId),
      ],
    };
    const resp = await this.client.searchConversations(filter, { first: ASM_SEARCH_PAGE_SIZE });
    if (resp.conversationIds.length === 0) return [];
    if (resp.pageInfo?.hasNextPage) {
      logger.warn('asm.conversation.findByAppAndAgent_truncated', {
        appId: scope.appId,
        agentId,
        returnedCount: resp.conversationIds.length,
        pageSize: ASM_SEARCH_PAGE_SIZE,
      });
    }
    return this.findByIds(resp.conversationIds);
  }

  async updateTitle(conversationId: string, title: string): Promise<void> {
    await this.client.updateLabels({
      conversationId,
      labels: { [LABEL_TITLE]: title },
    });
  }

  async updateAgentId(conversationId: string, agentId: string): Promise<void> {
    await this.client.updateLabels({
      conversationId,
      labels: { [LABEL_AGENT_ID]: agentId },
    });
  }

  async getOrCreateForApp(
    scope: WorkspaceScope,
    agentId: string,
    title?: string
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    const existing = await this.getLatestForApp(scope);
    if (existing) {
      return { conversation: existing, isNew: false };
    }
    const conversation = await this.create(scope, agentId, title);
    return { conversation, isNew: true };
  }

  async delete(conversationId: string): Promise<void> {
    await this.client.closeConversation(conversationId);
  }

  async getConversationsWithMessageCount(
    scope: WorkspaceScope,
    options?: { limit?: number; offset?: number }
  ): Promise<Array<Conversation & { messageCount: number }>> {
    if (options?.offset) {
      logger.warn('asm.conversation.offset_not_supported', {
        offset: options.offset,
        reason: 'ASM uses cursor-based pagination; offset is ignored',
      });
    }
    const ids = await this.searchByAppId(scope.appId, options?.limit ?? 50);
    const settled = await Promise.allSettled(
      ids.map((id) => this.client.getConversation(id))
    );
    const results: Array<Conversation & { messageCount: number }> = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      if (result.status === 'rejected') {
        logger.warn('asm.conversation.getWithCount_partial_failure', {
          conversationId: ids[i],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        continue;
      }
      if (!result.value || result.value.status === 'CLOSED') continue;
      const messageCount = result.value.messages?.edges?.length ?? 0;
      results.push({ ...mapToConversation(result.value), messageCount });
    }
    return results;
  }

  async getConversationCount(scope: WorkspaceScope): Promise<number> {
    const conversations = await this.getByAppId(scope);
    return conversations.length;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async searchByAppId(appId: string, limit?: number): Promise<string[]> {
    const filter: AsmSearchFilter = {
      matchAll: labelFilter(LABEL_APP_ID, appId),
    };

    if (limit && limit <= ASM_SEARCH_PAGE_SIZE) {
      const resp = await this.client.searchConversations(filter, { first: limit });
      return resp.conversationIds;
    }

    const allIds: string[] = [];
    let after: string | undefined;
    let truncated = false;

    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const resp = await this.client.searchConversations(filter, { first: ASM_SEARCH_PAGE_SIZE, after });
      allIds.push(...resp.conversationIds);

      if (!resp.pageInfo?.hasNextPage) break;
      after = resp.pageInfo.endCursor ?? undefined;

      if (page === MAX_SEARCH_PAGES - 1) {
        truncated = true;
      }
    }

    if (truncated) {
      logger.warn('asm.conversation.searchByAppId_truncated', {
        appId,
        returnedCount: allIds.length,
        maxPages: MAX_SEARCH_PAGES,
        pageSize: ASM_SEARCH_PAGE_SIZE,
      });
    }

    return allIds;
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapToConversation(conv: AsmConversation): Conversation {
  const labels = conv.labels ?? {};
  return {
    id: conv.id,
    appId: (labels[LABEL_APP_ID] as string) ?? '',
    agentId: (labels[LABEL_AGENT_ID] as string) ?? '',
    title: (labels[LABEL_TITLE] as string) ?? conv.enrichedContext?.title_description?.title,
    createdAt: new Date(conv.createdAt),
    updatedAt: new Date(conv.updatedAt),
  };
}
