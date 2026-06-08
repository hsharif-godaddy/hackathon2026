import { ASMClient } from '@gd-asm/asm-client';
import type {
  ConversationInput,
  Conversation,
  MessageInput,
  MutationResponse,
  ParticipantInput,
  SearchFilter,
  SearchOutputV2,
  UpdateConversationLabelsInput,
  QueryMessageConnection,
} from '@gd-asm/asm-client';
import { logger } from '../../../logging/index.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

export interface PaginationOptions {
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

export class AsmClientWrapper {
  constructor(private readonly client: ASMClient) {}

  async createConversation(input: ConversationInput): Promise<MutationResponse> {
    return this.withRetry(() => this.client.createConversation(input));
  }

  // SDK signature: getConversation(id, first, after, last, before)
  async getConversation(
    id: string,
    pagination?: PaginationOptions,
  ): Promise<(Conversation & { messages?: QueryMessageConnection }) | null> {
    const { first, after, last, before } = pagination ?? {};
    return this.withRetry(() => this.client.getConversation(id, first, after, last, before));
  }

  async addMessages(conversationId: string, messages: MessageInput[]): Promise<MutationResponse | null> {
    return this.withRetry(() => this.client.addConversationMessages(conversationId, messages));
  }

  async closeConversation(conversationId: string): Promise<MutationResponse | null> {
    return this.withRetry(() => this.client.closeConversation(conversationId));
  }

  async updateLabels(input: UpdateConversationLabelsInput): Promise<MutationResponse | null> {
    return this.withRetry(() => this.client.updateConversationLabels(input));
  }

  async addParticipants(
    conversationId: string,
    participants: ParticipantInput[],
  ): Promise<MutationResponse | null> {
    return this.withRetry(() =>
      this.client.addConversationParticipants(conversationId, participants),
    );
  }

  // SDK signature: searchConversationsV2(filter, first, last, after, before)
  // Note: positional order differs from getConversation (last/after swapped)
  async searchConversations(
    filter: SearchFilter,
    pagination?: PaginationOptions,
  ): Promise<SearchOutputV2> {
    const { first, after, last, before } = pagination ?? {};
    return this.withRetry(() => this.client.searchConversationsV2(filter, first, last, after, before));
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(RETRY_DELAY_MS * attempt);
      }

      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = extractHttpStatus(err);

        if (status === 429 || (status !== undefined && status >= 500)) {
          logger.warn('asm.client.retryable_error', { status, attempt, error: lastError.message });
          continue;
        }

        if (isNetworkError(err)) {
          logger.warn('asm.client.network_error', { attempt, error: lastError.message });
          continue;
        }

        throw lastError;
      }
    }

    logger.error('asm.client.retries_exhausted', {
      attempts: MAX_RETRIES + 1,
      error: lastError!.message,
    });
    throw lastError;
  }
}

export function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as Record<string, unknown>;

  // Direct statusCode (e.g. our own wrapped errors)
  if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;

  // Apollo networkError: HTTP-level failures (429, 5xx) surface here
  const netErr = anyErr.networkError as Record<string, unknown> | undefined;
  if (netErr && typeof netErr.statusCode === 'number') return netErr.statusCode;

  // Apollo graphQLErrors: server-side errors with extensions.status
  const gqlErrors = anyErr.graphQLErrors as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
    const ext = gqlErrors[0]?.extensions as Record<string, unknown> | undefined;
    if (ext && typeof ext.status === 'string') {
      const parsed = parseInt(ext.status, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (ext && typeof ext.status === 'number') return ext.status;
  }

  // SDK re-thrown errors: cause.extensions.status (used by SDK's 404 check)
  const cause = anyErr.cause as Record<string, unknown> | undefined;
  if (cause?.extensions) {
    const ext = cause.extensions as Record<string, unknown>;
    if (typeof ext.status === 'string') {
      const parsed = parseInt(ext.status, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof ext.status === 'number') return ext.status;
  }

  return undefined;
}

function isNetworkError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'networkError' in (err as Record<string, unknown>)) {
    const netErr = (err as Record<string, unknown>).networkError as Record<string, unknown> | null;
    if (netErr && typeof netErr.statusCode === 'number') {
      return false;
    }
    return true;
  }
  const msg = err instanceof Error ? err.message : '';
  return msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
