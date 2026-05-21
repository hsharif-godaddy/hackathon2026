import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsmMessageStore } from '../asm-message-store.js';
import type { AsmClientWrapper } from '../asm-client-wrapper.js';
import type { Message } from '@gd-asm/asm-client';

describe('AsmMessageStore', function storeTests() {
  let mockClient: {
    getConversation: ReturnType<typeof vi.fn>;
    addMessages: ReturnType<typeof vi.fn>;
    searchConversations: ReturnType<typeof vi.fn>;
  };
  let store: AsmMessageStore;

  function makeAsmMessage(id: string, text: string, participantType: string, responseTo?: string[]): Message {
    return {
      id,
      createdAt: '2024-01-01T00:00:00Z',
      messageCreatedAt: '2024-01-01T00:00:00Z',
      contents: [{ text }],
      participant: { id: participantType.toLowerCase(), type: participantType as 'USER' | 'AGENT' },
      responseTo,
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
  }

  function makeConversationResponse(messages: Message[]) {
    return {
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      labels: {},
      messages: {
        edges: messages.map((m) => ({ cursor: m.id, node: m })),
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      },
    };
  }

  beforeEach(function reset() {
    mockClient = {
      getConversation: vi.fn().mockResolvedValue(makeConversationResponse([])),
      addMessages: vi.fn().mockResolvedValue({ success: true, id: 'conv-1' }),
      searchConversations: vi.fn().mockResolvedValue({ conversationIds: [], pageInfo: {} }),
    };
    store = new AsmMessageStore(mockClient as unknown as AsmClientWrapper);
  });

  it('should buffer in-progress messages and flush on completion', async function inProgressBuffer() {
    const msg = await store.addMessage('conv-1', 'agent', 'partial', {
      metadata: { inProgress: true },
    });
    expect(mockClient.addMessages).not.toHaveBeenCalled();

    await store.updateMessage(msg.id, { content: 'final', metadata: { inProgress: false } });
    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
    expect(mockClient.addMessages).toHaveBeenCalledWith(
      'conv-1',
      [expect.objectContaining({ id: msg.id })],
    );
  });

  it('should flush user messages immediately', async function userImmediate() {
    await store.addMessage('conv-1', 'user', 'hello');
    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
  });

  it('should set responseTo on subsequent messages', async function responseToTracking() {
    await store.addMessage('conv-1', 'user', 'first');
    const firstCallMsgs = mockClient.addMessages.mock.calls[0][1];
    expect(firstCallMsgs[0].responseTo).toBeUndefined();

    await store.addMessage('conv-1', 'agent', 'second');
    const secondCallMsgs = mockClient.addMessages.mock.calls[1][1];
    expect(secondCallMsgs[0].responseTo).toEqual([firstCallMsgs[0].id]);
  });

  it('should walk linear chain on getMessages', async function linearChain() {
    const m1 = makeAsmMessage('m1', 'hello', 'USER');
    const m2 = makeAsmMessage('m2', 'hi', 'AGENT', ['m1']);
    const m4 = makeAsmMessage('m4', 'orphan', 'USER', ['nonexistent']);
    (m4 as unknown as { createdAt: string }).createdAt = '2024-01-01T00:00:01Z';
    const m3 = makeAsmMessage('m3', 'thanks', 'USER', ['m2']);
    (m3 as unknown as { createdAt: string }).createdAt = '2024-01-01T00:00:02Z';

    mockClient.getConversation.mockResolvedValue(makeConversationResponse([m1, m2, m4, m3]));

    const messages = await store.getMessages('conv-1');
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('hello');
    expect(messages[1].content).toBe('hi');
    expect(messages[2].content).toBe('thanks');
  });

  it('should return last user message from chain', async function lastUser() {
    const m1 = makeAsmMessage('m1', 'user msg', 'USER');
    const m2 = makeAsmMessage('m2', 'agent reply', 'AGENT', ['m1']);
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([m1, m2]));
    const last = await store.getLastUserMessage('conv-1');
    expect(last).toBe('user msg');
  });

  it('should generate title by truncation', function titleGen() {
    expect(store.generateTitle('short')).toBe('short');
    const long = 'a'.repeat(100);
    expect(store.generateTitle(long)).toHaveLength(60);
    expect(store.generateTitle(long).endsWith('...')).toBe(true);
  });

  it('should deleteMessage as no-op', async function deleteNoop() {
    await expect(store.deleteMessage('any')).resolves.toBeUndefined();
  });

  it('should notify hooks on addMessage', async function hooks() {
    const hook = vi.fn();
    store.registerMessageAddedHook(hook);
    await store.addMessage('conv-1', 'user', 'test');
    expect(hook).toHaveBeenCalledTimes(1);
    store.unregisterMessageAddedHook(hook);
    await store.addMessage('conv-1', 'user', 'test2');
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('should throw when addMessages returns success: false', async function flushReject() {
    mockClient.addMessages.mockResolvedValue({ success: false, message: 'quota exceeded' });
    await expect(store.addMessage('conv-1', 'user', 'test')).rejects.toThrow('ASM addMessages failed');
  });

  it('should throw when addMessages rejects with network error', async function flushNetworkError() {
    mockClient.addMessages.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(store.addMessage('conv-1', 'user', 'test')).rejects.toThrow('ECONNREFUSED');
  });

  it('should return flushed message from getMessageById', async function flushedLookup() {
    const msg = await store.addMessage('conv-1', 'user', 'hello');
    const found = await store.getMessageById(msg.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe('hello');
  });

  it('should return null from getMessageById for unknown id', async function unknownId() {
    const found = await store.getMessageById('nonexistent');
    expect(found).toBeNull();
  });

  it('should log but not throw when a hook fails', async function hookError() {
    const badHook = vi.fn().mockRejectedValue(new Error('hook broke'));
    const goodHook = vi.fn();
    store.registerMessageAddedHook(badHook);
    store.registerMessageAddedHook(goodHook);
    await store.addMessage('conv-1', 'user', 'test');
    expect(badHook).toHaveBeenCalledTimes(1);
    expect(goodHook).toHaveBeenCalledTimes(1);
  });

  it('should flush user messages immediately even with inProgress: true', async function userBypassBuffer() {
    await store.addMessage('conv-1', 'user', 'hello', {
      metadata: { inProgress: true },
    });
    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
  });

  it('should seed lastMessageId from ASM on first flush per conversation', async function seedOnFirstFlush() {
    mockClient.getConversation.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: {
        edges: [{ cursor: 'existing-msg', node: makeAsmMessage('existing-msg', 'old', 'USER') }],
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      },
    });

    await store.addMessage('conv-1', 'user', 'new msg');
    const addCallMsgs = mockClient.addMessages.mock.calls[0][1];
    expect(addCallMsgs[0].responseTo).toEqual(['existing-msg']);
  });

  it('should propagate seedLastMessageId failure to prevent orphaned messages', async function seedFailurePropagates() {
    mockClient.getConversation.mockRejectedValue(new Error('ASM unavailable'));
    await expect(store.addMessage('conv-1', 'user', 'hello')).rejects.toThrow('ASM unavailable');
    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should aggregate tool-only agent messages into preceding agent message', async function toolAggregation() {
    const agentText = makeAsmMessage('a1', 'thinking...', 'AGENT');
    const toolOnly: Message = {
      id: 'a2',
      createdAt: '2024-01-01T00:00:01Z',
      messageCreatedAt: '2024-01-01T00:00:01Z',
      contents: [
        { toolRequestId: 'tr1', toolName: 'readFile', parameters: { path: '/tmp' } },
        { toolRequestId: 'tr1', toolName: 'readFile', result: { content: 'data' }, failed: false },
      ],
      participant: { id: 'agent', type: 'AGENT' },
      responseTo: ['a1'],
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([agentText, toolOnly]));
    const messages = await store.getMessages('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('thinking...');
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls![0].toolName).toBe('readFile');
    expect(messages[0].toolCalls![0].status).toBe('success');
  });

  it('should default toolName to "unknown" when ASM content has empty toolName', async function missingToolName() {
    const msg: Message = {
      id: 'a1',
      createdAt: '2024-01-01T00:00:00Z',
      messageCreatedAt: '2024-01-01T00:00:00Z',
      contents: [
        { text: 'hi' },
        { toolRequestId: 'tr-1', toolName: '', parameters: {} },
        { toolRequestId: 'tr-1', toolName: '', result: { ok: true }, failed: false },
      ],
      participant: { id: 'agent', type: 'AGENT' },
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([msg]));
    const messages = await store.getMessages('conv-1');
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls![0].toolName).toBe('unknown');
  });

  it('should handle extractToolCalls with ToolResultContent arriving without prior ToolRequestContent', async function orphanResult() {
    const msg: Message = {
      id: 'a1',
      createdAt: '2024-01-01T00:00:00Z',
      messageCreatedAt: '2024-01-01T00:00:00Z',
      contents: [
        { text: 'done' },
        { toolRequestId: 'tr-orphan', toolName: 'exec', result: { output: 'ok' }, failed: false },
      ],
      participant: { id: 'agent', type: 'AGENT' },
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([msg]));
    const messages = await store.getMessages('conv-1');
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls![0].id).toBe('tr-orphan');
    expect(messages[0].toolCalls![0].toolName).toBe('exec');
    expect(messages[0].toolCalls![0].status).toBe('success');
  });

  it('should normalize legacy snake_case segment tool calls on read', async function segmentNormalize() {
    const msg: Message = {
      id: 'a1',
      createdAt: '2024-01-01T00:00:00Z',
      messageCreatedAt: '2024-01-01T00:00:00Z',
      contents: [{ text: 'done' }],
      participant: { id: 'agent', type: 'AGENT' },
      metadata: {
        conversationId: 'conv-1',
        segments: [
          {
            id: 'seg-1',
            type: 'tool_call',
            timestamp: '2024-01-01T00:00:00Z',
            tool_call: { id: 'tc-1', tool_name: 'writeFile', tool_args: { path: '/tmp' }, status: 'completed' },
          },
          {
            id: 'seg-2',
            type: 'tool_call',
            timestamp: '2024-01-01T00:00:01Z',
            toolCall: { id: 'tc-2', name: 'readFile', input: { path: '/src' }, result: { data: 'x' } },
          },
        ],
      },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([msg]));
    const messages = await store.getMessages('conv-1');
    expect(messages[0].segments).toHaveLength(2);
    expect(messages[0].segments![0].tool_call!.toolName).toBe('writeFile');
    expect(messages[0].segments![0].tool_call!.toolArgs).toEqual({ path: '/tmp' });
    expect(messages[0].segments![0].tool_call!.status).toBe('success');
    expect(messages[0].segments![1].tool_call!.toolName).toBe('readFile');
    expect(messages[0].segments![1].tool_call!.toolArgs).toEqual({ path: '/src' });
    expect(messages[0].segments![1].tool_call!.toolResult).toEqual({ data: 'x' });
    expect(messages[0].segments![1].tool_call!.status).toBe('success');
  });

  it('should not leak internal metadata keys onto public message', async function metadataStrip() {
    const msg: Message = {
      id: 'a1',
      createdAt: '2024-01-01T00:00:00Z',
      messageCreatedAt: '2024-01-01T00:00:00Z',
      contents: [{ text: 'hi' }],
      participant: { id: 'user', type: 'USER' },
      metadata: { conversationId: 'conv-1', messageType: 'status', segments: [], contextAttachments: [], customField: 'kept' },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([msg]));
    const messages = await store.getMessages('conv-1');
    expect(messages[0].metadata).toEqual({ customField: 'kept' });
    expect(messages[0].metadata?.conversationId).toBeUndefined();
    expect(messages[0].metadata?.segments).toBeUndefined();
  });

  it('should paginate backwards when hasPreviousPage is true', async function pagination() {
    const m1 = makeAsmMessage('m1', 'first', 'USER');
    const m2 = makeAsmMessage('m2', 'second', 'AGENT', ['m1']);
    const m3 = makeAsmMessage('m3', 'third', 'USER', ['m2']);

    mockClient.getConversation
      .mockResolvedValueOnce({
        id: 'conv-1',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messages: {
          edges: [{ cursor: 'm2', node: m2 }, { cursor: 'm3', node: m3 }],
          pageInfo: { startCursor: 'm2', endCursor: 'm3', hasNextPage: false, hasPreviousPage: true },
        },
      })
      .mockResolvedValueOnce({
        id: 'conv-1',
        status: 'ACTIVE',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        messages: {
          edges: [{ cursor: 'm1', node: m1 }],
          pageInfo: { startCursor: 'm1', endCursor: 'm1', hasNextPage: true, hasPreviousPage: false },
        },
      });

    const messages = await store.getMessages('conv-1');
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('first');
    expect(messages[1].content).toBe('second');
    expect(messages[2].content).toBe('third');
    expect(mockClient.getConversation).toHaveBeenCalledTimes(2);
    expect(mockClient.getConversation).toHaveBeenCalledWith('conv-1', { last: 500, before: 'm2' });
  });

  it('should stop paginating when hasPreviousPage is false', async function paginationStop() {
    const m1 = makeAsmMessage('m1', 'only', 'USER');
    mockClient.getConversation.mockResolvedValue({
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      messages: {
        edges: [{ cursor: 'm1', node: m1 }],
        pageInfo: { startCursor: 'm1', endCursor: 'm1', hasNextPage: false, hasPreviousPage: false },
      },
    });

    const messages = await store.getMessages('conv-1');
    expect(messages).toHaveLength(1);
    expect(mockClient.getConversation).toHaveBeenCalledTimes(1);
  });

  it('should strip full toolCall payload from segment metadata to avoid oversized metadata', async function segmentStrip() {
    const segments = [
      {
        id: 'seg-1',
        type: 'tool_call' as const,
        timestamp: new Date('2024-01-01'),
        tool_call: { id: 'tc-1', toolName: 'readFile', toolArgs: { path: '/very/long/path' }, toolResult: { huge: 'data' }, status: 'success' as const, durationMs: 100 },
      },
    ];
    const toolCalls = [
      { id: 'tc-1', toolName: 'readFile', toolArgs: { path: '/very/long/path' }, toolResult: { huge: 'data' }, status: 'success' as const },
    ];

    await store.addMessage('conv-1', 'agent', 'done', { segments, toolCalls });

    const textCallMsgs = mockClient.addMessages.mock.calls[0][1];
    const storedSegments = textCallMsgs[0].metadata.segments;
    expect(storedSegments).toHaveLength(1);
    expect(storedSegments[0].tool_call.toolName).toBe('readFile');
    expect(storedSegments[0].tool_call.id).toBe('tc-1');
    expect(storedSegments[0].tool_call.status).toBe('success');
    expect(storedSegments[0].tool_call.durationMs).toBe(100);
    expect(storedSegments[0].tool_call.toolArgs).toBeUndefined();
    expect(storedSegments[0].tool_call.toolResult).toBeUndefined();
    expect(storedSegments[0].toolCall).toBeUndefined();
  });

  it('should round-trip tool calls through split-on-write and merge-on-read', async function roundTrip() {
    const toolCalls = [
      { id: 'tc-1', toolName: 'readFile', toolArgs: { path: '/tmp/foo' }, toolResult: { content: 'data' }, status: 'success' as const },
      { id: 'tc-2', toolName: 'writeFile', toolArgs: { path: '/tmp/bar', content: 'x' }, toolResult: { success: true }, status: 'success' as const },
    ];

    await store.addMessage('conv-1', 'agent', 'Here are the results:', { toolCalls });

    const allCalls = mockClient.addMessages.mock.calls;
    expect(allCalls.length).toBe(3);

    const textMsg = allCalls[0][1][0];
    expect(textMsg.contents[0].withTextContent.text).toBe('Here are the results:');

    const tc1Msg = allCalls[1][1][0];
    expect(tc1Msg.contents[0].withToolRequestContent.toolName).toBe('readFile');
    expect(tc1Msg.contents[1].withToolResultContent.toolName).toBe('readFile');

    const tc2Msg = allCalls[2][1][0];
    expect(tc2Msg.contents[0].withToolRequestContent.toolName).toBe('writeFile');

    const asmMessages: Message[] = [
      {
        id: textMsg.id,
        createdAt: '2024-01-01T00:00:00Z',
        messageCreatedAt: '2024-01-01T00:00:00Z',
        contents: [{ text: 'Here are the results:' }],
        participant: { id: 'agent', type: 'AGENT' },
        metadata: { conversationId: 'conv-1' },
      } as unknown as Message,
      {
        id: tc1Msg.id,
        createdAt: '2024-01-01T00:00:01Z',
        messageCreatedAt: '2024-01-01T00:00:01Z',
        contents: [
          { toolRequestId: 'tc-1', toolName: 'readFile', parameters: { path: '/tmp/foo' } },
          { toolRequestId: 'tc-1', toolName: 'readFile', result: { content: 'data' }, failed: false },
        ],
        participant: { id: 'agent', type: 'AGENT' },
        responseTo: [textMsg.id],
        metadata: { conversationId: 'conv-1', toolName: 'readFile' },
      } as unknown as Message,
      {
        id: tc2Msg.id,
        createdAt: '2024-01-01T00:00:02Z',
        messageCreatedAt: '2024-01-01T00:00:02Z',
        contents: [
          { toolRequestId: 'tc-2', toolName: 'writeFile', parameters: { path: '/tmp/bar', content: 'x' } },
          { toolRequestId: 'tc-2', toolName: 'writeFile', result: { success: true }, failed: false },
        ],
        participant: { id: 'agent', type: 'AGENT' },
        responseTo: [tc1Msg.id],
        metadata: { conversationId: 'conv-1', toolName: 'writeFile' },
      } as unknown as Message,
    ];

    mockClient.getConversation.mockResolvedValue(makeConversationResponse(asmMessages));
    const messages = await store.getMessages('conv-1');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Here are the results:');
    expect(messages[0].toolCalls).toHaveLength(2);
    expect(messages[0].toolCalls![0].toolName).toBe('readFile');
    expect(messages[0].toolCalls![0].toolArgs).toEqual({ path: '/tmp/foo' });
    expect(messages[0].toolCalls![0].toolResult).toEqual({ content: 'data' });
    expect(messages[0].toolCalls![0].status).toBe('success');
    expect(messages[0].toolCalls![1].toolName).toBe('writeFile');
    expect(messages[0].toolCalls![1].status).toBe('success');
  });
});
