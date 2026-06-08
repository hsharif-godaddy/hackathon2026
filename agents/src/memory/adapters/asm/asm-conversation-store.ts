import { randomUUID } from 'node:crypto';
import { validate as validateUuid } from 'uuid';
import type { Conversation as AsmConversationResponse, SearchFilter, FilterCondition, ParticipantInput } from '@gd-asm/asm-client';
import { FilterOperator, PrincipalType, Scope, TimeInterval } from '@gd-asm/asm-client';
import { logger } from '../../../logging/index.js';
import type { Conversation } from '../../../database/schema.js';
import type { ConversationLifecycleStore } from '../../interfaces/index.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';
import type { AsmClientWrapper } from './asm-client-wrapper.js';

const LABEL_APP_ID = 'appId';
const LABEL_CUSTOMER_ID = 'customerId';
const LABEL_AGENT_ID = 'agentId';
const LABEL_TITLE = 'title';

const ASM_SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 5;
const ASM_READ_GROUP = 'AiroBuilderReadOnlyGroup';
const ASM_WRITE_GROUP = 'AiroBuilderWriteGroup';
const ASM_RETENTION_DAYS = 730;

export { LABEL_APP_ID, LABEL_CUSTOMER_ID, LABEL_AGENT_ID, LABEL_TITLE };

export function labelFilter(key: string, value: unknown): FilterCondition[] {
  return [
    { condition: { field: 'labels.key', operator: FilterOperator.Equals, value: key } },
    { condition: { field: 'labels.value', operator: FilterOperator.Equals, value } },
  ];
}

export class AsmConversationLifecycleStore implements ConversationLifecycleStore {
  constructor(private readonly client: AsmClientWrapper, private readonly serviceId: string) {}

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

    // Record the agent (and customer, when its id is a UUID) as ASM participants
    // for richer conversation metadata. This is enrichment only — agentId is
    // still tracked via LABEL_AGENT_ID above, which find/read/update rely on, so
    // the participant list never drives agent resolution.
    const participants: ParticipantInput[] = [
      { withSystem: { id: this.serviceId } },
      { withAgent: { id: agentId, name: agentId } },
    ];
    // Venus rejects CUSTOMER participants whose id isn't a UUID. Local scopes have
    // no customerId; resolved scopes still guard since the value isn't always a UUID.
    if (scope.kind === 'resolved' && validateUuid(scope.customerId)) {
      participants.push({ withCustomer: { id: scope.customerId } });
    }

    await this.client.createConversation({
      id: conversationId,
      labels,
      context: {},
      participants,
      messages: [],
      // No ASM enrichment — we manage titles via labels/updateTitle().
      // The SDK only exposes RUNNING_SUMMARY and COMPOSITE_SENTIMENT; the old
      // TITLE_DESCRIPTION technique is not available in the typed enum.
      enrichmentStrategy: { techniques: [] },
      retentionPolicy: { interval: TimeInterval.Day, value: ASM_RETENTION_DAYS },
      acl: [
        { principal: ASM_READ_GROUP, scopes: [Scope.Read], type: PrincipalType.AccessGroup },
        { principal: ASM_WRITE_GROUP, scopes: [Scope.Read, Scope.Write], type: PrincipalType.AccessGroup },
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
    const filter: SearchFilter = {
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
    const resp = await this.client.updateLabels({
      conversationId,
      labels: { [LABEL_TITLE]: title },
    });
    if (resp && !resp.success) {
      logger.warn('asm.conversation.updateTitle_failed', {
        conversationId,
        message: resp.message,
      });
    }
  }

  async updateAgentId(conversationId: string, agentId: string): Promise<void> {
    // The label is the source of truth for the current agent (overwritten each
    // time); find/read resolve agentId from it.
    const resp = await this.client.updateLabels({
      conversationId,
      labels: { [LABEL_AGENT_ID]: agentId },
    });
    if (resp && !resp.success) {
      logger.warn('asm.conversation.updateAgentId_failed', {
        conversationId,
        agentId,
        message: resp.message,
      });
    }
    // Also append the agent as a participant so ASM keeps the full participation
    // record across handoffs. Best-effort enrichment — it never drives resolution.
    const participantResp = await this.client.addParticipants(conversationId, [
      { withAgent: { id: agentId, name: agentId } },
    ]);
    if (participantResp && !participantResp.success) {
      logger.warn('asm.conversation.updateAgentId_participant_failed', {
        conversationId,
        agentId,
        message: participantResp.message,
      });
    }
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
    const resp = await this.client.closeConversation(conversationId);
    if (resp && !resp.success) {
      logger.warn('asm.conversation.delete_failed', {
        conversationId,
        message: resp.message,
      });
    }
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
    const filter: SearchFilter = {
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

function mapToConversation(conv: AsmConversationResponse): Conversation {
  const labels = (conv.labels ?? {}) as Record<string, unknown>;
  return {
    id: conv.id,
    appId: (labels[LABEL_APP_ID] as string) ?? '',
    agentId: (labels[LABEL_AGENT_ID] as string) ?? '',
    title: (labels[LABEL_TITLE] as string) ?? undefined,
    createdAt: conv.createdAt instanceof Date ? conv.createdAt : new Date(conv.createdAt as unknown as string),
    updatedAt: conv.updatedAt instanceof Date ? conv.updatedAt : new Date(conv.updatedAt as unknown as string),
  };
}
