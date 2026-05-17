import { logger } from '../../../logging/index.js';
import type {
  AsmConversationInput,
  AsmAddMessagesInput,
  AsmUpdateLabelsInput,
  AsmSearchFilter,
  AsmMutationResponse,
  AsmConversation,
  AsmSearchOutputV2,
} from './asm-types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AsmClientConfig {
  baseUrl: string;
  getAuthToken: () => string | Promise<string>;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// GraphQL operations
// ---------------------------------------------------------------------------

const CREATE_CONVERSATION = `
  mutation CreateConversation($input: ConversationInput) {
    createConversation(input: $input) { success message id }
  }
`;

const GET_CONVERSATION = `
  query GetConversation($id: ID!, $first: Int, $after: String, $last: Int, $before: String) {
    conversation(id: $id) {
      id status createdAt updatedAt labels context
      participants { id type ... on Customer { name } ... on Agent { name } }
      messages(first: $first, after: $after, last: $last, before: $before) {
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          cursor
          node {
            id createdAt messageCreatedAt responseTo metadata
            contents { __typename ... on TextContent { text } ... on ToolRequestContent { toolRequestId toolName parameters } ... on ToolResultContent { toolRequestId toolName result failed } }
            participant { id type ... on Customer { name } ... on Agent { name } }
            stats { latency modelUsage { tokens { input output } stopReason } }
          }
        }
      }
      enrichedContext { title_description { title description confidence } }
    }
  }
`;

const ADD_MESSAGES = `
  mutation AddMessages($input: AddMessagesInput) {
    addConversationMessages(input: $input) { success message id }
  }
`;

const CLOSE_CONVERSATION = `
  mutation CloseConversation($input: CloseConversationInput) {
    closeConversation(input: $input) { success message id }
  }
`;

const UPDATE_LABELS = `
  mutation UpdateLabels($input: UpdateConversationLabelsInput) {
    updateConversationLabels(input: $input) { success message id }
  }
`;

const SEARCH_CONVERSATIONS = `
  query SearchConversations($filter: SearchFilter!, $first: Int, $after: String, $last: Int, $before: String) {
    searchConversationsV2(filter: $filter, first: $first, after: $after, last: $last, before: $before) {
      conversationIds
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AsmClient {
  private readonly endpoint: string;
  private readonly getAuthToken: () => string | Promise<string>;

  constructor(config: AsmClientConfig) {
    const base = config.baseUrl.replace(/\/$/, '');
    this.endpoint = `${base}/v1/conversation/graphql`;
    this.getAuthToken = config.getAuthToken;
  }

  async createConversation(input: AsmConversationInput): Promise<AsmMutationResponse> {
    const data = await this.execute<{ createConversation: AsmMutationResponse }>(
      CREATE_CONVERSATION,
      { input }
    );
    return data.createConversation;
  }

  async getConversation(
    id: string,
    pagination?: { first?: number; after?: string; last?: number; before?: string }
  ): Promise<AsmConversation | null> {
    const data = await this.execute<{ conversation: AsmConversation | null }>(
      GET_CONVERSATION,
      { id, ...pagination }
    );
    return data.conversation;
  }

  async addMessages(input: AsmAddMessagesInput): Promise<AsmMutationResponse> {
    const data = await this.execute<{ addConversationMessages: AsmMutationResponse }>(
      ADD_MESSAGES,
      { input }
    );
    return data.addConversationMessages;
  }

  async closeConversation(conversationId: string): Promise<AsmMutationResponse> {
    const data = await this.execute<{ closeConversation: AsmMutationResponse }>(
      CLOSE_CONVERSATION,
      { input: { conversationId } }
    );
    return data.closeConversation;
  }

  async updateLabels(input: AsmUpdateLabelsInput): Promise<AsmMutationResponse> {
    const data = await this.execute<{ updateConversationLabels: AsmMutationResponse }>(
      UPDATE_LABELS,
      { input }
    );
    return data.updateConversationLabels;
  }

  async searchConversations(
    filter: AsmSearchFilter,
    pagination?: { first?: number; after?: string; last?: number; before?: string }
  ): Promise<AsmSearchOutputV2> {
    const data = await this.execute<{ searchConversationsV2: AsmSearchOutputV2 }>(
      SEARCH_CONVERSATIONS,
      { filter, ...pagination }
    );
    return data.searchConversationsV2;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async execute<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let token: string;
    try {
      token = await this.getAuthToken();
    } catch (authErr) {
      logger.error('asm.client.auth_token_failed', {
        error: authErr instanceof Error ? authErr.message : String(authErr),
      });
      throw authErr;
    }
    const headers: Record<string, string> = {
      'Authorization': `sso-jwt ${token}`,
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ query, variables });

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(RETRY_DELAY_MS * attempt);
      }

      let response: Response;
      try {
        response = await fetch(this.endpoint, { method: 'POST', headers, body });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('asm.client.fetch_error', { attempt, error: lastError.message });
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`ASM GraphQL returned ${response.status}`);
        logger.warn('asm.client.retryable_status', { status: response.status, attempt });
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let graphqlErrors: Array<{ message: string }> | undefined;
        try {
          const parsed = JSON.parse(text) as { errors?: Array<{ message: string }> };
          if (parsed.errors?.length) graphqlErrors = parsed.errors;
        } catch {
          // Not valid JSON — fall through to raw error
        }
        if (graphqlErrors) {
          const msg = graphqlErrors.map((e) => e.message).join('; ');
          logger.error('asm.client.graphql_error', { status: response.status, errors: msg });
          throw new AsmGraphQLError(msg, graphqlErrors);
        }
        logger.error('asm.client.http_error', { status: response.status, body: text.slice(0, 500) });
        throw new AsmApiError(response.status, text);
      }

      const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

      if (json.errors && json.errors.length > 0) {
        const msg = json.errors.map((e) => e.message).join('; ');
        logger.error('asm.client.graphql_error', { errors: msg });
        throw new AsmGraphQLError(msg, json.errors);
      }

      if (!json.data) {
        throw new AsmApiError(response.status, 'No data in GraphQL response');
      }

      return json.data;
    }

    const finalError = lastError ?? new Error('ASM GraphQL request failed after retries');
    logger.error('asm.client.retries_exhausted', {
      attempts: MAX_RETRIES + 1,
      error: finalError.message,
    });
    throw finalError;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AsmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`ASM returned ${status}: ${body.slice(0, 200)}`);
    this.name = 'AsmApiError';
  }
}

export class AsmGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ message: string }>
  ) {
    super(`ASM GraphQL error: ${message}`);
    this.name = 'AsmGraphQLError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
