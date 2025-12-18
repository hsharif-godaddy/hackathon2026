'use client';

import React, { useState } from 'react';
import Button from '@ux/button';
import AlertIcon from '@ux/icon/alert';
import RefreshIcon from '@ux/icon/refresh';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { useAppIdFromParams } from '@/app/develop/components/utils';
import {
  type ConversationMessage,
  type ToolCall,
  useConversationMessages,
  useConversations} from '@/hooks/useConversations';
import { useTranslations } from '@/hooks/useTranslations';

/**
 * Formats a timestamp for relative time display
 */
function formatRelativeTime(timestamp: string, t: ReturnType<typeof useTranslations>): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('builder_time_now');
    if (diffMins < 60) return t('builder_time_minutes_ago', { minutes: diffMins });
    if (diffHours < 24) return t('builder_time_hours_ago', { hours: diffHours});
    if (diffDays < 7) return t('builder_time_days_ago', { days: diffDays });

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return timestamp;
  }
}

/**
 * Component to display a single tool call
 */
function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const status = toolCall.status || 'completed';

  const statusClassName = status === 'success' || status === 'completed'
    ? 'bg-intents-ux-badge-success-backgroundColor text-intents-ux-badge-success-color'
    : status === 'error'
    ? 'bg-intents-ux-badge-destructive-backgroundColor text-intents-ux-badge-destructive-color'
    : 'bg-intents-ux-badge-warning-backgroundColor text-intents-ux-badge-warning-color';

  return (
    <div className="border border-intents-ux-box-borderColor rounded bg-intents-ux-box-backgroundColor text-xs mt-2">
      <div
        className="flex items-center justify-between p-2 cursor-pointer hover:bg-intents-ux-button-secondary-hover-backgroundColor"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusClassName}`}>
            {status}
          </span>
          <text.span className="font-mono font-medium">{toolCall.name}</text.span>
          {toolCall.duration && (
            <text.span className="text-intents-ux-text-subtle">{toolCall.duration}ms</text.span>
          )}
        </div>
        <text.span className="text-intents-ux-text-subtle">{expanded ? '▼' : '▶'}</text.span>
      </div>
      {expanded && (
        <div className="border-t border-intents-ux-box-borderColor p-2 space-y-2">
          <div>
            <text.p className="text-[10px] font-semibold text-intents-ux-text-subtle uppercase mb-1">{t('builder_tools_default_arguments')}</text.p>
            <pre className="p-2 rounded text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(toolCall.input, null, 2).slice(0, 2000)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <text.p className="text-[10px] font-semibold text-intents-ux-text-subtle uppercase mb-1">{t('builder_tools_default_result')}</text.p>
              <pre className="p-2 rounded text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
                {typeof toolCall.result === 'string'
                  ? toolCall.result.slice(0, 1000)
                  : JSON.stringify(toolCall.result, null, 2).slice(0, 1000)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div>
              <text.p className="text-[10px] font-semibold text-intents-ux-text-destructive uppercase mb-1">{t('builder_status_error')}</text.p>
              <pre className="bg-intents-ux-alert-destructive-backgroundColor text-intents-ux-text-destructive p-2 rounded text-[10px] overflow-x-auto">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Component to display a single message with full details
 */
function MessageDisplay({ message }: { message: ConversationMessage }) {
  const t = useTranslations();
  const [showRaw, setShowRaw] = useState(false);
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasMetadata = message.metadata && Object.keys(message.metadata).length > 0;
  const hasAttachments = message.contextAttachments && message.contextAttachments.length > 0;

  return (
    <div
      className={`p-3 rounded-lg ${
        message.sender === 'user'
          ? 'bg-blue-50 border border-blue-100'
          : 'bg-white border border-gray-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${
            message.sender === 'user' ? 'text-blue-700' : 'text-gray-700'
          }`}>
            {message.sender === 'user' ? t('builder_common_user') : t('builder_common_agent')}
          </span>
          {message.messageType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded">
              {message.messageType}
            </span>
          )}
          {hasToolCalls && (
            <span className="text-[10px] px-1.5 py-0.5 rounded">
              {t('builder_settings_conversations_tools', { count: message.toolCalls.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-[10px]"
          >
            {showRaw ? t('builder_settings_conversations_raw_hide') : t('builder_settings_conversations_raw_show')}
          </button>
          <span className="text-xs">
            {formatRelativeTime(message.createdAt, t)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="text-sm whitespace-pre-wrap break-words">
        {message.content.length > 1000 && !showRaw
          ? `${message.content.slice(0, 1000)}...`
          : message.content}
      </div>

      {/* Tool Calls */}
      {hasToolCalls && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase mb-1">
            {t('builder_settings_conversations_tool_calls')}
          </div>
          {message.toolCalls.map((tc, idx) => (
            <ToolCallDisplay key={tc.id || idx} toolCall={tc} />
          ))}
        </div>
      )}

      {/* Metadata */}
      {hasMetadata && showRaw && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase mb-1">
            {t('builder_settings_conversations_metadata')}
          </div>
          <pre className="p-2 rounded text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
            {JSON.stringify(message.metadata, null, 2)}
          </pre>
        </div>
      )}

      {/* Context Attachments */}
      {hasAttachments && showRaw && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase mb-1">
            {t('builder_settings_conversations_context_att')} ({message.contextAttachments.length})
          </div>
          {message.contextAttachments.map((att, idx) => (
            <div key={idx} className="text-[10px] p-2 rounded mt-1">
              <span className="font-medium">{t('builder_common_type')}:</span> {att.type}
            </div>
          ))}
        </div>
      )}

      {/* Raw JSON */}
      {showRaw && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase mb-1">{t('builder_settings_conversations_full_json')}</div>
          <pre className="p-2 rounded text-[10px] overflow-x-auto max-h-48 overflow-y-auto">
            {JSON.stringify(message, null, 2)}
          </pre>
        </div>
      )}

      {/* Message ID */}
      <div className="mt-2 text-[10px] font-mono">
        ID: {message.id}
      </div>
    </div>
  );
}

/**
 * Panel component for viewing conversations from the agents database
 */
export default function ConversationsPanel() {
  const t = useTranslations();
  const appId = useAppIdFromParams();

  const [expandedConversation, setExpandedConversation] = useState<string | null>(null);

  // Use React Query for conversations
  const {
    data: conversationsData,
    isLoading: loading,
    error: conversationsError,
    refetch: refetchConversations
  } = useConversations(appId);

  // Use React Query for messages of expanded conversation
  const {
    data: messages,
    isLoading: loadingMessages
  } = useConversationMessages(appId, expandedConversation);

  const conversations = conversationsData?.conversations ?? [];
  const total = conversationsData?.total ?? 0;
  const error = conversationsError?.message ?? null;

  const toggleExpand = (conversationId: string) => {
    if (expandedConversation === conversationId) {
      setExpandedConversation(null);
    } else {
      setExpandedConversation(conversationId);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <text.h2 className="text-xl font-semibold">{t('builder_settings_conversations_title')}</text.h2>
          <text.p className="text-sm mt-1">{t('builder_settings_conversations_desc')}</text.p>
        </div>
        <Button
          design="secondary"
          icon={<RefreshIcon />}
          onClick={() => refetchConversations()}
          disabled={loading}
          text={t('builder_common_refresh')}
        />
      </div>

      {/* Stats bar */}
      <div className="text-sm">
        {t('builder_settings_conversations_total_found', { count: total })}
      </div>

      {/* Error state */}
      {error && (
        <div className="border rounded-lg p-4 flex items-start justify-between bg-intents-ux-alert-destructive-backgroundColor border-intents-ux-alert-destructive-borderColor">
          <div className="flex items-start gap-3">
            <AlertIcon className="text-intents-ux-text-destructive size-5" />
            <div>
              <text.p className="font-semibold" emphasis="critical">{t('builder_settings_conversations_error_title')}</text.p>
              <text.p className="text-sm" emphasis="critical">{error}</text.p>
            </div>
          </div>
          <Button
            design="inline"
            onClick={() => refetchConversations()}
            text={t('builder_common_retry')}
          />
        </div>
      )}

      {/* Loading state */}
      {loading && conversations.length === 0 && (
        <div className="flex flex-col justify-center items-center h-64 gap-4">
          <Spinner size="md" />
          <text.p>{t('builder_settings_conversations_loading')}</text.p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && conversations.length === 0 && (
        <div className="text-center py-16 rounded-lg border">
          <text.p className="text-lg mb-2">{t('builder_settings_conversations_not_found_title')}</text.p>
          <text.p className="text-sm">{t('builder_settings_conversations_not_found_desc')}</text.p>
        </div>
      )}

      {/* Conversations list */}
      {conversations.length > 0 && (
        <div className="space-y-3">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="border rounded-lg overflow-hidden"
            >
              {/* Conversation header */}
              <div
                className="p-4 cursor-pointer transition-colors"
                onClick={() => toggleExpand(conversation.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {conversation.title || t('builder_settings_conversations_untitled')}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full">
                        {t('builder_settings_conversations_messages', { count: conversation.messageCount })}
                      </span>
                    </div>
                    {conversation.lastMessage && (
                      <p className="text-sm mt-1 truncate">
                        {conversation.lastMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end ml-4 flex-shrink-0">
                    <span className="text-xs">
                      {formatRelativeTime(conversation.updatedAt, t)}
                    </span>
                    <span className="text-xs font-mono mt-1">
                      {conversation.id.slice(0, 8)}...
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded messages */}
              {expandedConversation === conversation.id && (
                <div className="border-t p-4">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center py-8">
                      <Spinner size="sm" />
                      <span className="ml-2">{t('builder_settings_conversations_messages_loading')}</span>
                    </div>
                  ) : messages ? (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {messages.length === 0 ? (
                        <p className="text-sm text-center py-4">
                          {t('builder_settings_conversations_messages_empty')}
                        </p>
                      ) : (
                        messages.map((message) => (
                          <MessageDisplay key={message.id} message={message} />
                        ))
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-center py-4">
                      {t('builder_settings_conversations_messages_failed')}
                    </p>
                  )}

                  {/* Conversation Metadata */}
                  <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div>
                      <span>{t('builder_settings_conversations_metadata_conversation')}:</span>
                      <span className="font-mono ml-1 break-all">{conversation.id}</span>
                    </div>
                    <div>
                      <span>{t('builder_settings_conversations_metadata_agent')}:</span>
                      <span className="font-mono ml-1">{conversation.agentId}</span>
                    </div>
                    <div>
                      <span>{t('builder_settings_conversations_metadata_created')}:</span>
                      <span className="ml-1">
                        {new Date(conversation.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span>{t('builder_settings_conversations_metadata_updated')}:</span>
                      <span className="ml-1">
                        {new Date(conversation.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
