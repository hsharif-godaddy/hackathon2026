/**
 * Per-conversation and per-app markdown formatter for the debug-console
 * Agent Text export. Ported from the deleted
 * agents/src/services/conversation-exporter.ts so the formatter has
 * exactly one home and the agents service no longer needs to render
 * markdown.
 *
 * Types match the JSON shape returned by GET /agent/conversations/:appId
 * and GET /agent/conversations/:appId/:conversationId — ISO date strings,
 * camelCase fields. We accept legacy snake_case tool-call fields as a
 * last-resort migration shim.
 */

export type ExportDetail = 'summary' | 'full';

export interface Conversation {
    id: string;
    appId: string;
    agentId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export interface ToolCall {
    id?: string;
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

export interface ConversationMessage {
    id: string;
    conversationId: string;
    sender: 'user' | 'agent' | string;
    content?: string;
    messageType?: string | null;
    toolCalls?: ToolCall[];
    createdAt: string;
}

interface NormalizedToolCall {
    id?: string;
    toolName: string;
    toolArgs: unknown;
    toolResult: unknown;
    durationMs: number | undefined;
    status: string;
    error: string | undefined;
}

function normalizeToolCall(tc: ToolCall): NormalizedToolCall {
    return {
        id: tc.id,
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

export function formatExportHeader(appId: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `# App Conversations: ${appId}\n\nExported: ${date}\n\n`;
}

export function formatExportFooter(): string {
    return '---\n';
}

export function formatConversationMarkdown(
    conversation: Conversation,
    messages: ConversationMessage[],
    detail: ExportDetail,
): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push('');
    const title = conversation.title || 'Untitled';
    lines.push(`## ${conversation.agentId} — ${title}`);
    lines.push('');
    lines.push(`Created: ${conversation.createdAt}`);
    lines.push('');

    const visible = detail === 'summary'
        ? messages.filter((m) => !m.messageType)
        : messages;

    for (const message of visible) {
        const time = message.createdAt.split('T')[1]?.split('.')[0] ?? '';
        const role = message.sender === 'user' ? 'User' : 'Agent';
        lines.push(`**${role}** (${time}):`);
        if (message.content) {
            lines.push(message.content);
        }
        if (message.toolCalls && message.toolCalls.length > 0) {
            lines.push('');
            for (const tc of message.toolCalls) {
                lines.push(detail === 'summary' ? formatToolCallSummary(tc) : formatToolCallFull(tc));
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}
