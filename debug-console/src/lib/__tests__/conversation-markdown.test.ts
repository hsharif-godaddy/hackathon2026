import { describe, it, expect } from 'vitest';
import {
    formatExportHeader,
    formatExportFooter,
    formatConversationMarkdown,
    type Conversation,
    type ConversationMessage,
} from '../conversation-markdown';

const conversation: Conversation = {
    id: 'conv-1',
    appId: 'test-app',
    agentId: 'develop',
    title: 'Login bug',
    createdAt: '2026-03-09T10:00:00.000Z',
    updatedAt: '2026-03-09T10:05:00.000Z',
};

const messages: ConversationMessage[] = [
    {
        id: 'msg-1',
        conversationId: 'conv-1',
        sender: 'user',
        content: 'Hello',
        createdAt: '2026-03-09T10:00:00.000Z',
    },
    {
        id: 'msg-2',
        conversationId: 'conv-1',
        sender: 'agent',
        content: 'Hi there!',
        createdAt: '2026-03-09T10:01:00.000Z',
        toolCalls: [
            { id: 'tc-1', toolName: 'readFile', toolArgs: { path: '/index.html' }, toolResult: '<html/>', status: 'success', durationMs: 100 },
        ],
    },
];

describe('formatExportHeader', () => {
    it('includes app id and exported date', () => {
        const out = formatExportHeader('test-app');
        expect(out).toContain('# App Conversations: test-app');
        expect(out).toMatch(/Exported: \d{4}-\d{2}-\d{2}/);
    });
});

describe('formatExportFooter', () => {
    it('returns the trailing separator', () => {
        expect(formatExportFooter()).toContain('---');
    });
});

describe('formatConversationMarkdown', () => {
    it('summary mode renders user, agent, and one-line tool call summary', () => {
        const out = formatConversationMarkdown(conversation, messages, 'summary');
        expect(out).toContain('## develop — Login bug');
        expect(out).toContain('Hello');
        expect(out).toContain('Hi there!');
        expect(out).toContain('readFile');
        expect(out).not.toContain('<details>');
    });

    it('full mode expands tool calls', () => {
        const out = formatConversationMarkdown(conversation, messages, 'full');
        expect(out).toContain('<details>');
        expect(out).toContain('readFile');
        expect(out).toContain('/index.html');
    });

    it('handles legacy snake_case tool calls', () => {
        const legacy: ConversationMessage[] = [
            {
                id: 'msg-3',
                conversationId: 'conv-1',
                sender: 'agent',
                content: 'Done',
                createdAt: '2026-03-09T10:02:00.000Z',
                toolCalls: [
                    { id: 'tc-2', name: 'writeFile', input: { path: '/a.txt' }, result: 'ok', status: 'completed', duration: 50 },
                ],
            },
        ];
        const out = formatConversationMarkdown(conversation, legacy, 'summary');
        expect(out).toContain('writeFile');
    });

    it('renders Untitled when title is missing', () => {
        const noTitle = { ...conversation, title: '' };
        const out = formatConversationMarkdown(noTitle, [], 'summary');
        expect(out).toContain('## develop — Untitled');
    });
});
