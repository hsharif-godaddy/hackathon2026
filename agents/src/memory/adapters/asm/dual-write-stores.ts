import { validate as validateUuid } from 'uuid';
import { logger } from '../../../logging/index.js';
import type {
  Conversation,
  ConversationMessage,
  MessageSegment,
  ToolCall,
} from '../../../database/schema.js';
import type {
  ConversationLifecycleStore,
  HistoryMessage,
  MessageAddedHook,
  MessageStore,
  PaginatedMessagesResult,
  StoredContextAttachment,
} from '../../interfaces/conversation-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';
import { workspaceScopeFromAppId } from '../../interfaces/scope.js';
import { AsmConversationLifecycleStore } from './asm-conversation-store.js';
import { AsmMessageStore, AsmConversationNotFoundError } from './asm-message-store.js';
import { extractHttpStatus } from './asm-client-wrapper.js';
import { getActiveAgentContext } from '../../../lib/agent-context-storage.js';

type ErrorClass =
  | 'auth'
  | 'http_4xx'
  | 'http_5xx'
  | 'graphql'
  | 'timeout'
  | 'network'
  | 'oversize'
  | 'unknown';

type MirrorTelemetry = {
  operation: string;
  appId?: string;
  conversationId?: string;
  messageId?: string;
  summaryId?: string;
};

// Single ordered queue. Every mirror runs after the previous one, so ASM sees
// writes in the same order SQLite did (create → message-A → message-B).
let mirrorChain: Promise<void> = Promise.resolve();

function enqueueMirror(telemetry: MirrorTelemetry, task: () => Promise<void>): void {
  if (!isDualWriteEnabled()) return;
  mirrorChain = mirrorChain.then(() => mirror(telemetry, task));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && validateUuid(value);
}

function isInProgress(message: ConversationMessage): boolean {
  return message.metadata?.inProgress === true;
}

export class DualWriteConversationLifecycleStore implements ConversationLifecycleStore {
  constructor(
    private readonly primary: ConversationLifecycleStore,
    private readonly asm: AsmConversationLifecycleStore
  ) {}

  async create(
    scope: WorkspaceScope,
    agentId: string,
    title?: string,
    id?: string
  ): Promise<Conversation> {
    const conversation = await this.primary.create(scope, agentId, title, id);
    enqueueMirror(
      { operation: 'conversation.create', appId: scope.appId, conversationId: conversation.id },
      () => this.asm.create(scope, agentId, title, conversation.id).then(() => undefined)
    );
    return conversation;
  }

  getById(conversationId: string): Promise<Conversation | null> {
    return this.primary.getById(conversationId);
  }

  findByIds(conversationIds: string[]): Promise<Conversation[]> {
    return this.primary.findByIds(conversationIds);
  }

  getByAppId(scope: WorkspaceScope): Promise<Conversation[]> {
    return this.primary.getByAppId(scope);
  }

  getLatestForApp(scope: WorkspaceScope): Promise<Conversation | null> {
    return this.primary.getLatestForApp(scope);
  }

  findByAppAndAgent(scope: WorkspaceScope, agentId: string): Promise<Conversation[]> {
    return this.primary.findByAppAndAgent(scope, agentId);
  }

  async updateTitle(conversationId: string, title: string): Promise<void> {
    await this.primary.updateTitle(conversationId, title);
    enqueueMirror({ operation: 'conversation.update_title', conversationId }, () =>
      this.asm.updateTitle(conversationId, title)
    );
  }

  async updateAgentId(conversationId: string, agentId: string): Promise<void> {
    await this.primary.updateAgentId(conversationId, agentId);
    enqueueMirror({ operation: 'conversation.update_agent', conversationId }, () =>
      this.asm.updateAgentId(conversationId, agentId)
    );
  }

  async getOrCreateForApp(
    scope: WorkspaceScope,
    agentId: string,
    title?: string
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    const result = await this.primary.getOrCreateForApp(scope, agentId, title);
    if (result.isNew) {
      enqueueMirror(
        {
          operation: 'conversation.get_or_create.created',
          appId: scope.appId,
          conversationId: result.conversation.id,
        },
        () => this.asm.create(scope, agentId, title, result.conversation.id).then(() => undefined)
      );
    }
    return result;
  }

  async delete(conversationId: string): Promise<void> {
    // Look up before delete so the mirror skips a non-existent conversation
    // (an ASM delete-of-nothing would log a noisy failure).
    const conversation = await this.primary.getById(conversationId);
    await this.primary.delete(conversationId);
    if (conversation) {
      enqueueMirror(
        { operation: 'conversation.delete', conversationId, appId: conversation.appId },
        () => this.asm.delete(conversationId)
      );
    }
  }

  getConversationsWithMessageCount(
    scope: WorkspaceScope,
    options?: { limit?: number; offset?: number }
  ): Promise<Array<Conversation & { messageCount: number }>> {
    return this.primary.getConversationsWithMessageCount(scope, options);
  }

  getConversationCount(scope: WorkspaceScope): Promise<number> {
    return this.primary.getConversationCount(scope);
  }
}

export class DualWriteMessageStore implements MessageStore {
  constructor(
    private readonly primary: MessageStore,
    private readonly asm: AsmMessageStore,
    private readonly sqliteConversations: ConversationLifecycleStore,
    private readonly asmConversations: AsmConversationLifecycleStore
  ) {}

  async addMessage(
    conversationId: string,
    sender: 'user' | 'agent',
    content: string,
    options?: {
      messageType?: 'status' | 'tool_result' | 'error';
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
      contextAttachments?: StoredContextAttachment[];
      origin?: 'support' | 'customer';
      customerId?: string;
      agentId?: string;
    }
  ): Promise<ConversationMessage> {
    const message = await this.primary.addMessage(conversationId, sender, content, options);
    if (!isInProgress(message)) {
      this.mirrorUpsert(conversationId, message, options?.customerId);
    }
    return message;
  }

  registerMessageAddedHook(hook: MessageAddedHook): void {
    this.primary.registerMessageAddedHook(hook);
  }

  unregisterMessageAddedHook(hook: MessageAddedHook): void {
    this.primary.unregisterMessageAddedHook(hook);
  }

  getMessageById(messageId: string): Promise<ConversationMessage | null> {
    return this.primary.getMessageById(messageId);
  }

  async updateMessageMetadata(
    messageId: string,
    metadataUpdates: Record<string, unknown>
  ): Promise<void> {
    await this.primary.updateMessageMetadata(messageId, metadataUpdates);
    await this.mirrorIfTerminal(messageId);
  }

  async updateMessage(
    messageId: string,
    updates: {
      content?: string;
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.primary.updateMessage(messageId, updates);
    await this.mirrorIfTerminal(messageId);
  }

  hasMessagesForApp(scope: WorkspaceScope): Promise<boolean> {
    return this.primary.hasMessagesForApp(scope);
  }

  getMessageCount(conversationId: string): Promise<number> {
    return this.primary.getMessageCount(conversationId);
  }

  getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.primary.getMessages(conversationId);
  }

  getLastUserMessage(conversationId: string): Promise<string | null> {
    return this.primary.getLastUserMessage(conversationId);
  }

  getMessagesPaginated(
    scope: WorkspaceScope,
    conversationId: string,
    options?: { limit?: number; before?: string }
  ): Promise<PaginatedMessagesResult> {
    return this.primary.getMessagesPaginated(scope, conversationId, options);
  }

  getMessagesForHistory(conversationId: string): Promise<HistoryMessage[]> {
    return this.primary.getMessagesForHistory(conversationId);
  }

  getMessagesBatch(conversationIds: string[]): Promise<ConversationMessage[]> {
    return this.primary.getMessagesBatch(conversationIds);
  }

  async deleteMessage(messageId: string): Promise<void> {
    // Look up before delete so the mirror skips a non-existent message.
    const stored = await this.primary.getMessageById(messageId);
    await this.primary.deleteMessage(messageId);
    if (!stored) return;
    enqueueMirror(
      { operation: 'message.delete', messageId, conversationId: stored.conversationId },
      () => this.asm.deleteMessage(messageId)
    );
  }

  generateTitle(firstMessage: string): string {
    return this.primary.generateTitle(firstMessage);
  }

  private async mirrorIfTerminal(messageId: string): Promise<void> {
    if (!isDualWriteEnabled()) return;
    const message = await this.primary.getMessageById(messageId);
    if (!message || isInProgress(message)) return;
    this.mirrorUpsert(message.conversationId, message);
  }

  private mirrorUpsert(
    conversationId: string,
    message: ConversationMessage,
    customerId?: string
  ): void {
    const scopedCustomerId = customerId ?? getActiveAgentContext()?.customerId;
    if (message.sender === 'user' && !isUuid(scopedCustomerId)) {
      logger.warn('asm.dualwrite.user_mirror_skipped.invalid_customer_id', {
        conversationId,
        messageId: message.id,
      });
      return;
    }
    enqueueMirror(
      { operation: 'message.upsert', conversationId, messageId: message.id },
      () => this.mirrorMessageWithConversationRecovery(conversationId, message, scopedCustomerId)
    );
  }

  private async mirrorMessageWithConversationRecovery(
    conversationId: string,
    message: ConversationMessage,
    customerId?: string
  ): Promise<void> {
    const participantContext = {
      customerId,
      agentId: message.metadata?.agentId as string | undefined,
    };
    try {
      await this.asm.mirrorCompleteMessage(conversationId, message, participantContext);
    } catch (error: unknown) {
      if (!(error instanceof AsmConversationNotFoundError)) throw error;
      // Bounded recovery: recreate from SQLite once, then retry the mirror once.
      // If ASM still reports the conversation missing, mirror() logs and the
      // ordered queue moves on to later writes.
      await this.recreateAsmConversation(conversationId, customerId);
      await this.asm.mirrorCompleteMessage(conversationId, message, participantContext);
    }
  }

  private async recreateAsmConversation(conversationId: string, customerId?: string): Promise<void> {
    const conversation = await this.sqliteConversations.getById(conversationId);
    if (!conversation) {
      throw new Error(`cannot recreate ASM conversation ${conversationId}: no SQLite record`);
    }
    const scope: WorkspaceScope = workspaceScopeFromAppId(conversation.appId, customerId);
    logger.warn('asm.dualwrite.conversation_recreated', {
      conversationId,
      appId: conversation.appId,
      agentId: conversation.agentId,
    });
    await this.asmConversations.create(
      scope,
      conversation.agentId,
      conversation.title,
      conversationId
    );
  }
}

async function mirror(telemetry: MirrorTelemetry, task: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    // No task-level timeout here: the ASM SDK client is constructed with a 5s
    // per-request timeout (see adapters/index.ts) and AsmClientWrapper.withRetry
    await task();
    logger.info('asm.dualwrite.write.ok', { ...telemetry, durationMs: Date.now() - start });
  } catch (error: unknown) {
    logFailure(telemetry, start, error);
  }
}

function logFailure(telemetry: MirrorTelemetry, start: number, error: unknown): void {
  const errorClass = classifyError(error);
  // Programmer errors (TypeError/RangeError/SyntaxError/ReferenceError) and
  // unclassified failures escalate to `error` so Sentry/stderr captures them.
  // Operational classes stay at `warn` to avoid alert fatigue.
  const escalate = errorClass === 'unknown' || isProgrammerError(error);
  const fields = {
    ...telemetry,
    durationMs: Date.now() - start,
    errorClass,
    error: error instanceof Error ? error.message : String(error),
  };
  if (escalate) {
    logger.error('asm.dualwrite.write.failure', fields);
  } else {
    logger.warn('asm.dualwrite.write.failure', fields);
  }
}

function isProgrammerError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof SyntaxError ||
    err instanceof ReferenceError
  );
}

function classifyError(err: unknown): ErrorClass {
  const status = extractHttpStatus(err);
  if (status !== undefined) {
    if (status === 401 || status === 403) return 'auth';
    if (status >= 500) return 'http_5xx';
    if (status >= 400) return 'http_4xx';
  }
  const gqlCode = extractGraphqlCode(err);
  if (gqlCode) {
    const code = gqlCode.toUpperCase();
    if (code.includes('UNAUTHENTICATED') || code.includes('AUTH') || code.includes('FORBIDDEN')) {
      return 'auth';
    }
    if (code.includes('TOO_LARGE') || code.includes('SIZE')) {
      return 'oversize';
    }
    return 'graphql';
  }
  if (err instanceof Error) {
    const causeCode = extractNodeErrorCode(err);
    if (causeCode) {
      if (causeCode === 'ABORT_ERR' || causeCode === 'ETIMEDOUT') return 'timeout';
      if (causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND' || causeCode === 'ECONNRESET' || causeCode === 'EAI_AGAIN') {
        return 'network';
      }
    }
    const name = err.name.toLowerCase();
    const message = err.message.toLowerCase();
    if (name === 'aborterror' || message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }
    if (
      message.includes('auth') ||
      message.includes('token') ||
      message.includes('unauthor')
    ) {
      return 'auth';
    }
    if (message.includes('too large') || message.includes('exceeds') || message.includes('size limit')) {
      return 'oversize';
    }
    if (
      message.includes('econn') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('fetch failed') ||
      message.includes('network')
    ) {
      return 'network';
    }
  }
  return 'unknown';
}

function extractGraphqlCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const obj = err as Record<string, unknown>;
  const gqlErrors = obj.graphQLErrors as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
    const ext = gqlErrors[0]?.extensions as Record<string, unknown> | undefined;
    if (ext && typeof ext.code === 'string') return ext.code;
  }
  return undefined;
}

function extractNodeErrorCode(err: Error): string | undefined {
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return undefined;
}

// JWT claim opts a tenant in via switchboard; env opts a whole deployment in.
// Background callers (no request context) see no claim and fall through to env.
function isDualWriteEnabled(): boolean {
  return getActiveAgentContext()?.asmDualWriteEnabled === true
    || process.env.ASM_DUALWRITE_ENABLED === 'true';
}
