import { describe, it, expect } from 'vitest';
import { exportConversations } from '../conversation-exporter.js';
import type { Conversation, ConversationMessage } from '../../database/schema.js';

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1',
  appId: 'app-123',
  agentId: 'develop',
  title: 'Build a landing page',
  createdAt: new Date('2026-03-09T10:00:00Z'),
  updatedAt: new Date('2026-03-09T10:05:00Z'),
  ...overrides,
});

const makeMessage = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  sender: 'user',
  content: 'Hello',
  createdAt: new Date('2026-03-09T10:00:00Z'),
  ...overrides,
});

describe('exportConversations', () => {
  it('renders summary format with user and agent messages', () => {
    const conversations = [makeConversation()];
    const messages: Map<string, ConversationMessage[]> = new Map([
      ['conv-1', [
        makeMessage({ sender: 'user', content: 'Build me a landing page' }),
        makeMessage({
          id: 'msg-2',
          sender: 'agent',
          content: 'I will create a landing page for you.',
          toolCalls: [
            { id: 'tc-1', tool_name: 'generateCode', tool_args: { file: 'index.html' }, tool_result: 'ok', status: 'success', duration_ms: 1200 },
            { id: 'tc-2', tool_name: 'editFile', tool_args: { file: 'style.css' }, tool_result: 'ok', status: 'success', duration_ms: 300 },
          ],
          createdAt: new Date('2026-03-09T10:01:00Z'),
        }),
      ]],
    ]);

    const result = exportConversations('app-123', conversations, messages, 'summary');

    expect(result).toContain('# App Conversations: app-123');
    expect(result).toContain('## develop — Build a landing page');
    expect(result).toContain('**User**');
    expect(result).toContain('Build me a landing page');
    expect(result).toContain('**Agent**');
    expect(result).toContain('I will create a landing page for you.');
    expect(result).toContain('> Tools used: generateCode, editFile');
    // Summary should NOT contain tool args/results
    expect(result).not.toContain('index.html');
    expect(result).not.toContain('style.css');
  });

  it('renders full format with tool call details', () => {
    const conversations = [makeConversation()];
    const messages: Map<string, ConversationMessage[]> = new Map([
      ['conv-1', [
        makeMessage({
          id: 'msg-2',
          sender: 'agent',
          content: 'Creating files.',
          toolCalls: [
            { id: 'tc-1', tool_name: 'generateCode', tool_args: { file: 'index.html' }, tool_result: { created: true }, status: 'success', duration_ms: 1500 },
          ],
          createdAt: new Date('2026-03-09T10:01:00Z'),
        }),
      ]],
    ]);

    const result = exportConversations('app-123', conversations, messages, 'full');

    expect(result).toContain('<details>');
    expect(result).toContain('generateCode');
    expect(result).toContain('success');
    expect(result).toContain('1.5s');
    expect(result).toContain('index.html');
    expect(result).toContain('"created": true');
  });

  it('handles camelCase tool call fields from raw DB data', () => {
    const conversations = [makeConversation()];
    const messages: Map<string, ConversationMessage[]> = new Map([
      ['conv-1', [
        makeMessage({
          id: 'msg-2',
          sender: 'agent',
          content: 'Working on it.',
          toolCalls: [
            // Raw DB format: camelCase keys, status: 'completed'
            { id: 'tc-1', name: 'readFile', input: { path: '/app/index.html' }, result: '<html>...</html>', status: 'completed', duration: 200 } as any,
          ],
          createdAt: new Date('2026-03-09T10:01:00Z'),
        }),
      ]],
    ]);

    const summaryResult = exportConversations('app-123', conversations, messages, 'summary');
    expect(summaryResult).toContain('> Tools used: readFile');

    const fullResult = exportConversations('app-123', conversations, messages, 'full');
    expect(fullResult).toContain('readFile');
    expect(fullResult).toContain('success'); // 'completed' normalized to 'success'
    expect(fullResult).toContain('0.2s');
    expect(fullResult).toContain('/app/index.html');
    expect(fullResult).toContain('<html>...</html>');
  });

  it('handles conversations with no title', () => {
    const conversations = [makeConversation({ title: undefined })];
    const messages: Map<string, ConversationMessage[]> = new Map([['conv-1', []]]);

    const result = exportConversations('app-123', conversations, messages, 'summary');
    expect(result).toContain('## develop — Untitled');
  });

  it('handles empty conversations', () => {
    const result = exportConversations('app-123', [], new Map(), 'summary');
    expect(result).toContain('# App Conversations: app-123');
    expect(result).toContain('No conversations found');
  });

  it('skips status and error message types in summary', () => {
    const conversations = [makeConversation()];
    const messages: Map<string, ConversationMessage[]> = new Map([
      ['conv-1', [
        makeMessage({ content: 'Generating...', messageType: 'status' }),
        makeMessage({ id: 'msg-err', content: 'Something went wrong', messageType: 'error' }),
        makeMessage({ content: 'Real message', sender: 'user' }),
      ]],
    ]);

    const result = exportConversations('app-123', conversations, messages, 'summary');
    expect(result).not.toContain('Generating...');
    expect(result).not.toContain('Something went wrong');
    expect(result).toContain('Real message');
  });

  it('includes all message types in full mode', () => {
    const conversations = [makeConversation()];
    const messages: Map<string, ConversationMessage[]> = new Map([
      ['conv-1', [
        makeMessage({ content: 'Generating...', messageType: 'status' }),
        makeMessage({ id: 'msg-err', content: 'Something went wrong', messageType: 'error' }),
        makeMessage({ content: 'Real message', sender: 'user' }),
      ]],
    ]);

    const result = exportConversations('app-123', conversations, messages, 'full');
    expect(result).toContain('Generating...');
    expect(result).toContain('Something went wrong');
    expect(result).toContain('Real message');
  });

  it('formats timestamps as HH:MM:SS without milliseconds', () => {
    const conversations = [makeConversation()];
    const messages: Map<string, ConversationMessage[]> = new Map([
      ['conv-1', [
        makeMessage({ content: 'test', createdAt: new Date('2026-03-09T10:05:30.123Z') }),
      ]],
    ]);

    const result = exportConversations('app-123', conversations, messages, 'summary');
    expect(result).toContain('(10:05:30)');
    expect(result).not.toContain('.123');
  });
});
