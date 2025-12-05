import { useQuery } from '@tanstack/react-query';
import { buildDynamicAgentUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';

/**
 * Conversation structure from the agents API
 */
export interface Conversation {
  id: string;
  appId: string;
  agentId: string;
  title?: string;
  messageCount: number;
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tool call structure - matches the database format
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  status?: 'running' | 'success' | 'error' | 'completed';
}

/**
 * Message structure for conversation details
 */
export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  messageType?: string;
  toolCalls: ToolCall[];
  segments: Array<{ id: string; type: string; content?: string; tool_call?: ToolCall }>;
  metadata: Record<string, unknown>;
  contextAttachments: Array<{ type: string; data: unknown }>;
  createdAt: string;
}

/**
 * API response structure
 */
interface ConversationsResponse {
  conversations: Conversation[];
  total: number;
}

/**
 * Messages API response structure
 */
interface MessagesResponse {
  messages: ConversationMessage[];
}

/**
 * Hook to fetch conversations for an app using React Query
 *
 * @param appId - The app ID to fetch conversations for
 * @returns Query result with conversations data, loading, error states
 */
export function useConversations(appId: string | undefined) {
  return useQuery({
    queryKey: ['conversations', appId],
    queryFn: async (): Promise<{ conversations: Conversation[]; total: number }> => {
      if (!appId) {
        throw new Error('appId is required');
      }

      const conversationsUrl = await buildDynamicAgentUrl(`api/conversations?appId=${encodeURIComponent(appId)}`, appId);
      const response = await agentFetch(conversationsUrl, { siteId: appId });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch conversations');
      }

      const data: ConversationsResponse = await response.json();
      return {
        conversations: data.conversations,
        total: data.total
      };
    },
    enabled: !!appId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch messages for a specific conversation using React Query
 *
 * @param appId - The app ID
 * @param conversationId - The conversation ID to fetch messages for
 * @param enabled - Whether the query should be enabled
 * @returns Query result with messages data, loading, error states
 */
export function useConversationMessages(
  appId: string | undefined,
  conversationId: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: ['conversation-messages', appId, conversationId],
    queryFn: async (): Promise<ConversationMessage[]> => {
      if (!appId || !conversationId) {
        throw new Error('appId and conversationId are required');
      }

      const messagesUrl = await buildDynamicAgentUrl(
        `api/conversations/${encodeURIComponent(conversationId)}/messages?appId=${encodeURIComponent(appId)}`,
        appId
      );
      const response = await agentFetch(messagesUrl, { siteId: appId });

      if (!response.ok) {
        throw new Error('Failed to fetch messages');
      }

      const data: MessagesResponse = await response.json();
      return data.messages;
    },
    enabled: !!appId && !!conversationId && enabled,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

