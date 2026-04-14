import type { Conversation, ConversationMessage } from '../database/schema.js';
import { safeStringify } from '@airo/shared';

export type ExportDetail = 'summary' | 'full';

/**
 * Normalize a tool call from either camelCase (raw DB) or snake_case (typed) format.
 * The DB stores tool calls as {name, input, result, duration, status: 'completed'}
 * but the TypeScript interface uses {tool_name, tool_args, tool_result, duration_ms, status: 'success'}.
 */
function normalizeToolCall(tc: any): { toolName: string; toolArgs: any; toolResult: any; durationMs: number | undefined; status: string; error: string | undefined; id: string } {
  return {
    id: tc.id,
    toolName: tc.tool_name || tc.name || 'unknown',
    toolArgs: tc.tool_args ?? tc.input,
    toolResult: tc.tool_result ?? tc.result,
    durationMs: tc.duration_ms ?? tc.duration,
    status: tc.status === 'completed' ? 'success' : (tc.status || 'unknown'),
    error: tc.error,
  };
}

export function exportConversations(
  appId: string,
  conversations: Conversation[],
  messagesByConversation: Map<string, ConversationMessage[]>,
  detail: ExportDetail = 'summary',
): string {
  const lines: string[] = [];
  lines.push(`# App Conversations: ${appId}`);
  lines.push('');
  lines.push(`Exported: ${new Date().toISOString().split('T')[0]}`);
  lines.push('');

  if (conversations.length === 0) {
    lines.push('No conversations found.');
    return lines.join('\n');
  }

  for (const conversation of conversations) {
    lines.push('---');
    lines.push('');
    const title = conversation.title || 'Untitled';
    lines.push(`## ${conversation.agentId} — ${title}`);
    lines.push('');
    lines.push(`Created: ${conversation.createdAt.toISOString()}`);
    lines.push('');

    const messages = messagesByConversation.get(conversation.id) || [];
    const visibleMessages = detail === 'summary'
      ? messages.filter((m) => !m.messageType)
      : messages;

    for (const message of visibleMessages) {
      const time = message.createdAt.toISOString().split('T')[1]?.split('.')[0] || '';
      const role = message.sender === 'user' ? 'User' : 'Agent';
      lines.push(`**${role}** (${time}):`);
      if (message.content) {
        lines.push(message.content);
      }

      if (message.toolCalls && message.toolCalls.length > 0) {
        if (detail === 'summary') {
          lines.push('');
          const toolNames = message.toolCalls.map((tc: any) => normalizeToolCall(tc).toolName);
          lines.push(`> Tools used: ${toolNames.join(', ')}`);
        } else {
          lines.push('');
          for (const tc of message.toolCalls) {
            lines.push(formatToolCallFull(tc));
          }
        }
      }

      lines.push('');
    }
  }

  lines.push('---');
  return lines.join('\n');
}

function formatToolCallFull(rawTc: any): string {
  const tc = normalizeToolCall(rawTc);
  const duration = tc.durationMs ? `${(tc.durationMs / 1000).toFixed(1)}s` : 'n/a';
  const lines: string[] = [];
  lines.push(`<details><summary>Tool: ${tc.toolName} (${tc.status}, ${duration})</summary>`);
  lines.push('');
  lines.push('**Arguments:**');
  lines.push('```json');
  lines.push(safeStringify(tc.toolArgs, 2));
  lines.push('```');
  lines.push('');
  if (tc.toolResult !== undefined) {
    lines.push('**Result:**');
    lines.push('```json');
    lines.push(safeStringify(tc.toolResult, 2));
    lines.push('```');
  }
  if (tc.error) {
    lines.push('**Error:**');
    lines.push('```');
    lines.push(tc.error);
    lines.push('```');
  }
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}
