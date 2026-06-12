/**
 * Local Conversation Export CLI
 *
 * Exports conversations directly from the local SQLite database.
 * No auth, no running service needed.
 *
 * Usage:
 *   pnpm tsx scripts/local-export-chat.ts <appId> [--detail=summary|full]
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type ExportDetail = 'summary' | 'full';

interface ConversationRow {
  id: string;
  app_id: string;
  agent_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender: string;
  content: string;
  message_type: string | null;
  tool_calls: string | null;
  created_at: string;
}

interface ToolCall {
  toolName?: string;
  name?: string;
  tool_name?: string;
  toolArgs?: unknown;
  tool_args?: unknown;
  input?: unknown;
  toolResult?: unknown;
  tool_result?: unknown;
  result?: unknown;
  durationMs?: number;
  duration_ms?: number;
  duration?: number;
  status?: string;
  error?: string;
}

function normalizeToolCall(tc: ToolCall): { toolName: string; toolArgs: unknown; toolResult: unknown; durationMs: number | undefined; status: string; error: string | undefined } {
  return {
    toolName: tc.toolName ?? tc.tool_name ?? tc.name ?? 'unknown',
    toolArgs: tc.toolArgs ?? tc.tool_args ?? tc.input,
    toolResult: tc.toolResult ?? tc.tool_result ?? tc.result,
    durationMs: tc.durationMs ?? tc.duration_ms ?? tc.duration,
    status: tc.status === 'completed' ? 'success' : (tc.status ?? 'unknown'),
    error: tc.error,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatToolCallSummary(tc: ToolCall): string {
  const n = normalizeToolCall(tc);
  const status = n.status === 'success' ? '✓' : n.status === 'error' ? '✗' : '·';
  const duration = typeof n.durationMs === 'number' ? ` (${n.durationMs}ms)` : '';
  return `> **${n.toolName}** ${status}${duration}`;
}

function formatToolCallFull(tc: ToolCall): string {
  const n = normalizeToolCall(tc);
  const lines: string[] = [];
  lines.push(`<details><summary><strong>${n.toolName}</strong> [${n.status}]</summary>`);
  lines.push('');
  if (n.toolArgs !== undefined) {
    lines.push('Arguments:');
    lines.push('```json');
    lines.push(safeStringify(n.toolArgs));
    lines.push('```');
  }
  if (n.toolResult !== undefined) {
    lines.push('Result:');
    lines.push('```');
    lines.push(typeof n.toolResult === 'string' ? n.toolResult : safeStringify(n.toolResult));
    lines.push('```');
  }
  if (n.error) {
    lines.push(`Error: ${n.error}`);
  }
  if (typeof n.durationMs === 'number') {
    lines.push(`Duration: ${n.durationMs}ms`);
  }
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

// --- CLI ---

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith('--'));
const detailArg = args.find((a) => a.startsWith('--detail='));

if (!appId) {
  console.error('Usage: pnpm tsx scripts/local-export-chat.ts <appId> [--detail=summary|full]');
  process.exit(1);
}

const detail: ExportDetail = (detailArg?.split('=')[1] as ExportDetail) ?? 'full';
if (detail !== 'summary' && detail !== 'full') {
  console.error('Error: --detail must be "summary" or "full"');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(scriptDir, '..', 'data', 'apps.db');

const db = new Database(dbPath, { readonly: true });

const conversations = db.prepare(
  'SELECT id, app_id, agent_id, title, created_at, updated_at FROM conversations WHERE app_id = ? ORDER BY created_at ASC'
).all(appId) as ConversationRow[];

if (conversations.length === 0) {
  console.error(`No conversations found for app: ${appId}`);
  process.exit(0);
}

const date = new Date().toISOString().split('T')[0];
process.stdout.write(`# App Conversations: ${appId}\n\nExported: ${date}\n\n`);

const msgStmt = db.prepare(
  'SELECT id, conversation_id, sender, content, message_type, tool_calls, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC'
);

for (const conv of conversations) {
  const messages = msgStmt.all(conv.id) as MessageRow[];

  process.stdout.write('---\n\n');
  const title = conv.title || 'Untitled';
  process.stdout.write(`## ${conv.agent_id} — ${title}\n\n`);
  process.stdout.write(`Created: ${conv.created_at}\n\n`);

  const visible = detail === 'summary'
    ? messages.filter((m) => !m.message_type)
    : messages;

  for (const msg of visible) {
    const time = msg.created_at.split('T')[1]?.split('.')[0] ?? msg.created_at.split(' ')[1] ?? '';
    const role = msg.sender === 'user' ? 'User' : 'Agent';
    process.stdout.write(`**${role}** (${time}):\n`);
    if (msg.content) {
      process.stdout.write(`${msg.content}\n`);
    }

    if (msg.tool_calls) {
      try {
        const toolCalls: ToolCall[] = JSON.parse(msg.tool_calls);
        if (toolCalls.length > 0) {
          process.stdout.write('\n');
          for (const tc of toolCalls) {
            process.stdout.write((detail === 'summary' ? formatToolCallSummary(tc) : formatToolCallFull(tc)) + '\n');
          }
        }
      } catch { /* skip malformed tool_calls */ }
    }
    process.stdout.write('\n');
  }
}

process.stdout.write('---\n');
db.close();
