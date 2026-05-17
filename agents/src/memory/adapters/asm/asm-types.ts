// ASM (Agent State Memory) GraphQL API types and mappers.

// ---------------------------------------------------------------------------
// Label keys used by this adapter
// ---------------------------------------------------------------------------

export const LABEL_APP_ID = 'appId';
export const LABEL_CUSTOMER_ID = 'customerId';
export const LABEL_AGENT_ID = 'agentId';
export const LABEL_TITLE = 'title';

// ---------------------------------------------------------------------------
// GraphQL input types
// ---------------------------------------------------------------------------

export interface AsmRetentionPolicyInput {
  interval: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
  value: number;
}

export interface AsmConversationInput {
  id?: string;
  labels?: Record<string, unknown>;
  context?: Record<string, unknown>;
  participants?: AsmParticipantInput[];
  messages?: AsmMessageInput[];
  enrichmentStrategy?: { techniques: string[] };
  retentionPolicy?: AsmRetentionPolicyInput;
  acl?: AsmAclInput[];
}

export interface AsmParticipantInput {
  withAgent?: { id: string; name?: string; version?: string; metadata?: Record<string, unknown> };
  withCustomer?: { id: string; name?: string; metadata?: Record<string, unknown> };
  withSystem?: { id: string; metadata?: Record<string, unknown> };
}

export interface AsmMessageInput {
  id?: string;
  messageCreatedAt?: string;
  metadata?: Record<string, unknown>;
  contents?: AsmContentInput[];
  participant: AsmParticipantInput;
  responseTo?: string[];
  stats?: AsmStatsInput;
}

export interface AsmContentInput {
  withTextContent?: { text: string };
  withToolRequestContent?: { toolRequestId: string; toolName: string; parameters: unknown };
  withToolResultContent?: { toolRequestId: string; toolName: string; result: unknown; failed?: boolean };
}

export interface AsmStatsInput {
  latency?: number;
  modelUsage?: {
    tokens?: { input: number; output: number };
    stopReason?: string;
  };
}

export interface AsmAclInput {
  principal: string;
  scopes: string[];
  type: string;
}

export interface AsmAddMessagesInput {
  conversationId: string;
  messages: AsmMessageInput[];
}

export interface AsmUpdateLabelsInput {
  conversationId: string;
  labels: Record<string, unknown>;
}

export interface AsmSearchFilter {
  matchAll: Array<{
    condition: {
      field: string;
      operator: 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'RANGE';
      value?: unknown;
      values?: unknown[];
      range?: { from: string; to: string };
    };
  }>;
}

type FilterCondition = AsmSearchFilter['matchAll'][number];

/**
 * ASM search requires label filters as paired `labels.key` + `labels.value` conditions.
 * This helper builds the two conditions for a single label key=value lookup.
 */
export function labelFilter(key: string, value: unknown): FilterCondition[] {
  return [
    { condition: { field: 'labels.key', operator: 'EQUALS', value: key } },
    { condition: { field: 'labels.value', operator: 'EQUALS', value } },
  ];
}

// ---------------------------------------------------------------------------
// GraphQL response types
// ---------------------------------------------------------------------------

export interface AsmMutationResponse {
  success: boolean;
  message?: string;
  id?: string;
}

export interface AsmConversation {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  labels?: Record<string, unknown>;
  context?: Record<string, unknown>;
  participants?: AsmParticipant[];
  messages?: AsmMessageConnection;
  enrichedContext?: {
    title_description?: {
      title?: string;
      description?: string;
      confidence?: number;
    };
  };
}

export interface AsmMessageConnection {
  edges?: AsmMessageEdge[];
  pageInfo?: AsmPageInfo;
}

export interface AsmMessageEdge {
  cursor: string;
  node: AsmMessage;
}

export interface AsmPageInfo {
  startCursor?: string;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor?: string;
}

export interface AsmMessage {
  id: string;
  createdAt: string;
  messageCreatedAt?: string;
  contents?: AsmContent[];
  participant: AsmParticipant;
  responseTo?: string[];
  metadata?: Record<string, unknown>;
  stats?: {
    latency?: number;
    modelUsage?: {
      tokens?: { input: number; output: number };
    };
  };
}

export type AsmContent =
  | { __typename: 'TextContent'; text: string }
  | { __typename: 'ToolRequestContent'; toolRequestId: string; toolName: string; parameters: unknown }
  | { __typename: 'ToolResultContent'; toolRequestId: string; toolName: string; result: unknown; failed?: boolean }
  | { __typename: 'EventContent'; eventName: string; payload: unknown };

export interface AsmParticipant {
  id: string;
  type: 'USER' | 'AGENT' | 'SYSTEM' | 'DEFAULT';
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface AsmSearchOutputV2 {
  conversationIds: string[];
  pageInfo?: AsmPageInfo;
}
