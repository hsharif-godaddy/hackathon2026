/**
 * PATCH helpers for agents conversation message metadata.
 * Backend: agents/src/server/routes/conversations.ts
 */

import { buildDynamicAgentUrl } from '@/config/dynamic-api';
import { getConversationIdFromCookie } from '@/hooks/chat/useChatHelpers';
import { agentFetch } from '@/lib/agent-fetch';
import type { FeedbackValue } from '@/lib/feedback-client';

export type MessageFeedbackMetadata = FeedbackValue | null;

export function parseMessageFeedbackMetadata(
  metadata?: Record<string, unknown>
): MessageFeedbackMetadata {
  const value = metadata?.feedback;
  return value === 'positive' || value === 'negative' ? value : null;
}

export type PatchMessageMetadataResult = {
  ok: boolean;
  reason?: 'missing_conversation_id' | 'missing_app_id' | 'network_error' | 'http_error';
};

export async function patchMessageFeedbackMetadata(input: {
  appId: string;
  messageId: string;
  feedback: MessageFeedbackMetadata;
}): Promise<PatchMessageMetadataResult> {
  if (!input.appId) {
    return { ok: false, reason: 'missing_app_id' };
  }

  const conversationId = getConversationIdFromCookie(input.appId);
  if (!conversationId) {
    return { ok: false, reason: 'missing_conversation_id' };
  }

  try {
    const url = await buildDynamicAgentUrl(
      `api/conversations/${conversationId}/messages/${input.messageId}`,
      input.appId
    );

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return { ok: false, reason: 'network_error' };
    }

    const response = await agentFetch(url, {
      siteId: input.appId,
      method: 'PATCH',
      body: JSON.stringify({ metadata: { feedback: input.feedback } }),
    });

    if (!response.ok) {
      return { ok: false, reason: 'http_error' };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}
