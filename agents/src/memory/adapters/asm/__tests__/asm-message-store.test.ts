import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsmMessageStore, AsmConversationNotFoundError } from '../asm-message-store.js';
import type { AsmClientWrapper } from '../asm-client-wrapper.js';
import type { ConversationMessage } from '../../../../database/schema.js';
import type { Message } from '@gd-asm/asm-client';
import { ParticipantType } from '@gd-asm/asm-client';

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
      createdAt: new Date('2024-01-01T00:00:00Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
      contents: [{ text }],
      participant: { id: participantType.toLowerCase(), type: participantType as 'USER' | 'AGENT' },
      responseTo,
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
  }

  function makeConversationResponse(messages: ReadonlyArray<{ id: string }>) {
    return {
      id: 'conv-1',
      status: 'ACTIVE',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: '2024-01-01T00:00:00Z',
      labels: {},
      messages: {
        edges: messages.map((m) => ({ cursor: m.id, node: m })),
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      },
    };
  }

  function makeConversationMessage(overrides: Partial<ConversationMessage>): ConversationMessage {
    return {
      id: 'sqlite-id',
      conversationId: 'conv-1',
      sender: 'agent',
      content: 'hello',
      origin: 'support',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      ...overrides,
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

  it('mirrorCompleteMessage should write under a fresh ASM id and stash the SQLite id in metadata', async function mirrorCompleteWritesId() {
    await store.mirrorCompleteMessage(
      'conv-1',
      makeConversationMessage({ id: 'sqlite-nanoid', sender: 'user', content: 'hello' }),
      { customerId: '11111111-1111-4111-8111-111111111111' }
    );

    const asmMsg = mockClient.addMessages.mock.calls[0][1][0];
    // Fresh ASM id — not the SQLite id; the SQLite id rides in metadata.
    expect(asmMsg.id).not.toBe('sqlite-nanoid');
    expect(asmMsg.metadata.sqliteMessageId).toBe('sqlite-nanoid');
    expect(asmMsg.participant.withCustomer.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('mirrorCompleteMessage should append a fresh id per write and never self-reference on re-mirror', async function reMirrorFreshId() {
    const msg = makeConversationMessage({ id: 'sqlite-X', sender: 'agent', content: 'answer' });
    await store.mirrorCompleteMessage('conv-1', msg);
    // Re-mirror the same SQLite row (e.g. a post-finalize commitHash patch).
    await store.mirrorCompleteMessage('conv-1', { ...msg, metadata: { commitHash: 'abc123' } });

    const sent = mockClient.addMessages.mock.calls.map((c) => c[1][0]);
    expect(sent).toHaveLength(2);
    // Distinct fresh ASM ids, neither equal to the SQLite id.
    expect(sent[0].id).not.toBe('sqlite-X');
    expect(sent[1].id).not.toBe('sqlite-X');
    expect(sent[0].id).not.toBe(sent[1].id);
    // Both correlate back to the same SQLite row.
    expect(sent[0].metadata.sqliteMessageId).toBe('sqlite-X');
    expect(sent[1].metadata.sqliteMessageId).toBe('sqlite-X');
    // The re-mirror chains onto the first write, NOT onto itself.
    expect(sent[1].responseTo).toEqual([sent[0].id]);
    expect(sent[1].responseTo).not.toEqual([sent[1].id]);
  });

  it('mirrorCompleteMessage should emit a placeholder for an incomplete turn with no content', async function mirrorCompleteIncompletePlaceholder() {
    await store.mirrorCompleteMessage(
      'conv-1',
      makeConversationMessage({
        id: 'agent-incomplete',
        sender: 'agent',
        content: '',
        metadata: { inProgress: false, incomplete: true, outcome: 'disconnected' },
      })
    );

    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
    const sent = mockClient.addMessages.mock.calls[0][1][0];
    expect(sent.contents).toHaveLength(1);
    expect(sent.contents[0].withTextContent.text).toBe('[turn disconnected before agent response]');
  });

  it('mirrorCompleteMessage should skip a genuinely empty, non-incomplete message', async function mirrorCompleteSkipsEmpty() {
    await store.mirrorCompleteMessage(
      'conv-1',
      makeConversationMessage({ id: 'agent-empty', sender: 'agent', content: '' })
    );

    expect(mockClient.addMessages).not.toHaveBeenCalled();
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

  it('should throw AsmConversationNotFoundError when addMessages returns null (conversation missing)', async function flushNullNotFound() {
    mockClient.addMessages.mockResolvedValue(null);
    await expect(store.addMessage('conv-1', 'user', 'test')).rejects.toBeInstanceOf(
      AsmConversationNotFoundError
    );
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
      createdAt: new Date('2024-01-01T00:00:00Z'),
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
      createdAt: new Date('2024-01-01T00:00:01Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:01Z'),
      contents: [
        { toolRequestId: 'tr1', toolName: 'readFile', parameters: { path: '/tmp' } },
        { toolRequestId: 'tr1', toolName: 'readFile', result: { content: 'data' }, failed: false },
      ],
      participant: { id: 'agent', type: ParticipantType.Agent },
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

  it('should not bleed a new turn\'s tool calls into a prior disconnected-turn placeholder', async function noCrossTurnBleed() {
    // Turn 1 disconnects, leaving an incomplete-turn text placeholder. The conversation's
    // responseTo pointer advances through the placeholder, so turn 2's first (tool-only)
    // agent message chains directly from it. The placeholder must act as a turn boundary:
    // its tool calls stay on their own message, not folded into the placeholder.
    const userMsg = makeAsmMessage('u1', 'do the thing', 'USER');
    const placeholder: Message = {
      id: 'placeholder',
      createdAt: new Date('2024-01-01T00:00:01Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:01Z'),
      contents: [{ text: '[turn errored before agent response]' }],
      participant: { id: 'agent', type: ParticipantType.Agent },
      responseTo: ['u1'],
      metadata: { conversationId: 'conv-1', incomplete: true, outcome: 'errored' },
    } as unknown as Message;
    const resumedTool: Message = {
      id: 'resumed-tool',
      createdAt: new Date('2024-01-01T00:00:02Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:02Z'),
      contents: [
        { toolRequestId: 'tc-9', toolName: 'writeFile', parameters: { path: '/x' } },
        { toolRequestId: 'tc-9', toolName: 'writeFile', result: { ok: true }, failed: false },
      ],
      participant: { id: 'agent', type: ParticipantType.Agent },
      responseTo: ['placeholder'],
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([userMsg, placeholder, resumedTool]));

    const messages = await store.getMessages('conv-1');

    expect(messages).toHaveLength(3);
    const placeholderMsg = messages.find((m) => m.content === '[turn errored before agent response]');
    expect(placeholderMsg).toBeDefined();
    expect(placeholderMsg!.toolCalls).toBeUndefined();
    const toolMsg = messages.find((m) => m.id === 'resumed-tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCalls).toHaveLength(1);
    expect(toolMsg!.toolCalls![0].id).toBe('tc-9');
  });

  it('should not merge a new turn\'s tool calls into a prior empty-contents agent stub', async function noBleedIntoEmptyStub() {
    // The empty (non-incomplete) placeholder path produces an agent message with no
    // contents. It still carries a responseTo pointer, so the next turn's tool-only
    // message chains from it — but an empty stub is not a substantive response and
    // must not absorb a later turn's tool calls.
    const userMsg = makeAsmMessage('u1', 'do the thing', 'USER');
    const emptyStub: Message = {
      id: 'empty-stub',
      createdAt: new Date('2024-01-01T00:00:01Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:01Z'),
      contents: [],
      participant: { id: 'agent', type: ParticipantType.Agent },
      responseTo: ['u1'],
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
    const resumedTool: Message = {
      id: 'resumed-tool',
      createdAt: new Date('2024-01-01T00:00:02Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:02Z'),
      contents: [
        { toolRequestId: 'tc-7', toolName: 'readFile', parameters: { path: '/y' } },
        { toolRequestId: 'tc-7', toolName: 'readFile', result: { ok: true }, failed: false },
      ],
      participant: { id: 'agent', type: ParticipantType.Agent },
      responseTo: ['empty-stub'],
      metadata: { conversationId: 'conv-1' },
    } as unknown as Message;
    mockClient.getConversation.mockResolvedValue(makeConversationResponse([userMsg, emptyStub, resumedTool]));

    const messages = await store.getMessages('conv-1');

    const toolMsg = messages.find((m) => m.id === 'resumed-tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCalls).toHaveLength(1);
    expect(toolMsg!.toolCalls![0].id).toBe('tc-7');
    const stub = messages.find((m) => m.id === 'empty-stub');
    expect(stub?.toolCalls).toBeUndefined();
  });

  it('should default toolName to "unknown" when ASM content has empty toolName', async function missingToolName() {
    const msg: Message = {
      id: 'a1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
      contents: [
        { text: 'hi' },
        { toolRequestId: 'tr-1', toolName: '', parameters: {} },
        { toolRequestId: 'tr-1', toolName: '', result: { ok: true }, failed: false },
      ],
      participant: { id: 'agent', type: ParticipantType.Agent },
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
      createdAt: new Date('2024-01-01T00:00:00Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
      contents: [
        { text: 'done' },
        { toolRequestId: 'tr-orphan', toolName: 'exec', result: { output: 'ok' }, failed: false },
      ],
      participant: { id: 'agent', type: ParticipantType.Agent },
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
      createdAt: new Date('2024-01-01T00:00:00Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
      contents: [{ text: 'done' }],
      participant: { id: 'agent', type: ParticipantType.Agent },
      metadata: {
        conversationId: 'conv-1',
        segments: [
          {
            id: 'seg-1',
            type: 'tool_call',
            timestamp: new Date('2024-01-01T00:00:00Z'),
            tool_call: { id: 'tc-1', tool_name: 'writeFile', tool_args: { path: '/tmp' }, status: 'completed' },
          },
          {
            id: 'seg-2',
            type: 'tool_call',
            timestamp: new Date('2024-01-01T00:00:01Z'),
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
      createdAt: new Date('2024-01-01T00:00:00Z'),
      messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
      contents: [{ text: 'hi' }],
      participant: { id: 'user', type: ParticipantType.User },
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
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: '2024-01-01T00:00:00Z',
        messages: {
          edges: [{ cursor: 'm2', node: m2 }, { cursor: 'm3', node: m3 }],
          pageInfo: { startCursor: 'm2', endCursor: 'm3', hasNextPage: false, hasPreviousPage: true },
        },
      })
      .mockResolvedValueOnce({
        id: 'conv-1',
        status: 'ACTIVE',
        createdAt: new Date('2024-01-01T00:00:00Z'),
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
      createdAt: new Date('2024-01-01T00:00:00Z'),
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

  it('should batch text + tool calls into a single Venus message and round-trip on read', async function roundTrip() {
    const toolCalls = [
      { id: 'tc-1', toolName: 'readFile', toolArgs: { path: '/tmp/foo' }, toolResult: { content: 'data' }, status: 'success' as const },
      { id: 'tc-2', toolName: 'writeFile', toolArgs: { path: '/tmp/bar', content: 'x' }, toolResult: { success: true }, status: 'success' as const },
    ];

    await store.addMessage('conv-1', 'agent', 'Here are the results:', { toolCalls });

    const allCalls = mockClient.addMessages.mock.calls;
    expect(allCalls.length).toBe(1);

    const sent = allCalls[0][1][0];
    expect(sent.contents).toHaveLength(5);
    expect(sent.contents[0].withTextContent.text).toBe('Here are the results:');
    expect(sent.contents[1].withToolRequestContent.toolRequestId).toBe('tc-1');
    expect(sent.contents[1].withToolRequestContent.toolName).toBe('readFile');
    expect(sent.contents[2].withToolResultContent.toolRequestId).toBe('tc-1');
    expect(sent.contents[2].withToolResultContent.failed).toBe(false);
    expect(sent.contents[3].withToolRequestContent.toolRequestId).toBe('tc-2');
    expect(sent.contents[3].withToolRequestContent.toolName).toBe('writeFile');
    expect(sent.contents[4].withToolResultContent.toolRequestId).toBe('tc-2');

    const asmMessages = [
      {
        id: sent.id,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
        contents: [
          { typename: 'TextContent', text: 'Here are the results:' },
          { typename: 'ToolRequestContent', toolRequestId: 'tc-1', toolName: 'readFile', parameters: { path: '/tmp/foo' } },
          { typename: 'ToolResultContent', toolRequestId: 'tc-1', toolName: 'readFile', result: { content: 'data' }, failed: false },
          { typename: 'ToolRequestContent', toolRequestId: 'tc-2', toolName: 'writeFile', parameters: { path: '/tmp/bar', content: 'x' } },
          { typename: 'ToolResultContent', toolRequestId: 'tc-2', toolName: 'writeFile', result: { success: true }, failed: false },
        ],
        participant: { id: 'agent', type: ParticipantType.Agent },
        metadata: { conversationId: 'conv-1' },
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

  it('should normalize legacy {name, input, status: completed} tool calls before flushing', async function legacyToolCallShape() {
    // Regression: handoff-emitting agent turns are finalized via the
    // startAgentTurn previous-turn cleanup path, which only sets
    // metadata.inProgress=false and never runs the canonical normalizer in
    // completeConversation. The buffered toolCalls then carry the LLM-native
    // {name, input, status: 'completed'} shape. Without normalization on flush
    // the GraphQL payload omits toolName and Venus rejects the mutation,
    // dropping the whole turn (the buffer is deleted before the flush attempt).
    const msg = await store.addMessage('conv-1', 'agent', '', {
      metadata: { inProgress: true },
    });
    await store.updateMessage(msg.id, {
      toolCalls: [
        { id: 'tc-1', name: 'setProjectName', input: { name: 'Green Roots' }, result: 'ok', status: 'completed' },
        { id: 'tc-2', name: 'handoff', input: { targetAgent: 'develop' }, result: { success: true }, status: 'completed' },
      ] as unknown as Parameters<typeof store.updateMessage>[1]['toolCalls'],
    });
    await store.updateMessageMetadata(msg.id, { inProgress: false });

    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
    const sent = mockClient.addMessages.mock.calls[0][1][0];
    expect(sent.contents[0].withToolRequestContent.toolName).toBe('setProjectName');
    expect(sent.contents[0].withToolRequestContent.parameters).toEqual({ name: 'Green Roots' });
    expect(sent.contents[1].withToolResultContent.toolName).toBe('setProjectName');
    expect(sent.contents[1].withToolResultContent.failed).toBe(false);
    expect(sent.contents[2].withToolRequestContent.toolName).toBe('handoff');
    expect(sent.contents[2].withToolRequestContent.parameters).toEqual({ targetAgent: 'develop' });
    expect(sent.contents[3].withToolResultContent.toolName).toBe('handoff');
  });

  it('should reconstruct tool calls from a legacy fanned-out fixture (backward compat)', async function legacyFanOutRoundTrip() {
    // Simulates conversations written by the pre-batch code: one text-only AGENT
    // message followed by per-tool AGENT messages chained via responseTo.
    // aggregateToolMessages + extractToolCalls must still surface the full tool list.
    const asmMessages = [
      {
        id: 'agent-text',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
        contents: [{ typename: 'TextContent', text: 'thinking...' }],
        participant: { id: 'agent', type: ParticipantType.Agent },
        metadata: { conversationId: 'conv-1' },
      },
      {
        id: 'agent-tool-1',
        createdAt: new Date('2024-01-01T00:00:01Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:01Z'),
        contents: [
          { typename: 'ToolRequestContent', toolRequestId: 'tc-1', toolName: 'readFile', parameters: { path: '/tmp/foo' } },
          { typename: 'ToolResultContent', toolRequestId: 'tc-1', toolName: 'readFile', result: { content: 'data' }, failed: false },
        ],
        participant: { id: 'agent', type: ParticipantType.Agent },
        responseTo: ['agent-text'],
        metadata: { conversationId: 'conv-1', toolName: 'readFile' },
      },
      {
        id: 'agent-tool-2',
        createdAt: new Date('2024-01-01T00:00:02Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:02Z'),
        contents: [
          { typename: 'ToolRequestContent', toolRequestId: 'tc-2', toolName: 'writeFile', parameters: { path: '/tmp/bar' } },
          { typename: 'ToolResultContent', toolRequestId: 'tc-2', toolName: 'writeFile', result: { ok: true }, failed: false },
        ],
        participant: { id: 'agent', type: ParticipantType.Agent },
        responseTo: ['agent-tool-1'],
        metadata: { conversationId: 'conv-1', toolName: 'writeFile' },
      },
    ];

    mockClient.getConversation.mockResolvedValue(makeConversationResponse(asmMessages));
    const messages = await store.getMessages('conv-1');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('thinking...');
    expect(messages[0].toolCalls).toHaveLength(2);
    const byId = new Map(messages[0].toolCalls!.map((tc) => [tc.id, tc]));
    expect(byId.get('tc-1')?.toolName).toBe('readFile');
    expect(byId.get('tc-1')?.toolResult).toEqual({ content: 'data' });
    expect(byId.get('tc-2')?.toolName).toBe('writeFile');
    expect(byId.get('tc-2')?.toolResult).toEqual({ ok: true });
  });

  it('should skip purely empty agent messages on finalize', async function skipEmptyHealthy() {
    const msg = await store.addMessage('conv-1', 'agent', '', {
      metadata: { inProgress: true },
    });
    await store.updateMessage(msg.id, { metadata: { inProgress: false } });

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should mirror user messages with a UUID customerId in the participant payload', async function mirrorWhenUuidCustomerId() {
    const customerId = '11111111-1111-4111-8111-111111111111';
    await store.addMessage('conv-1', 'user', 'hello', {
      customerId,
    });

    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
    const sent = mockClient.addMessages.mock.calls[0]![1][0];
    expect(sent.participant.withCustomer.id).toBe(customerId);
  });

  it('should preserve tc.error round-trip for failed tool calls', async function toolErrorRoundTrip() {
    const toolCalls = [
      {
        id: 'tc-fail',
        toolName: 'readFile',
        toolArgs: { path: '/missing' },
        toolResult: undefined,
        error: 'ENOENT: no such file',
        status: 'error' as const,
      },
    ];

    await store.addMessage('conv-1', 'agent', 'I tried to read it:', { toolCalls });

    const allCalls = mockClient.addMessages.mock.calls;
    expect(allCalls.length).toBe(1);

    const sent = allCalls[0]![1][0];
    expect(sent.contents[0].withTextContent.text).toBe('I tried to read it:');
    const resultContent = sent.contents.find(
      (c: { withToolResultContent?: unknown }) => c.withToolResultContent
    ).withToolResultContent;
    expect(resultContent.failed).toBe(true);
    expect(resultContent.result.error).toBe('ENOENT: no such file');

    const asmMessages = [
      {
        id: sent.id,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
        contents: [
          { typename: 'TextContent', text: 'I tried to read it:' },
          { typename: 'ToolRequestContent', toolRequestId: 'tc-fail', toolName: 'readFile', parameters: { path: '/missing' } },
          { typename: 'ToolResultContent', toolRequestId: 'tc-fail', toolName: 'readFile', result: { error: 'ENOENT: no such file' }, failed: true },
        ],
        participant: { id: 'agent', type: ParticipantType.Agent },
        metadata: { conversationId: 'conv-1' },
      },
    ];

    mockClient.getConversation.mockResolvedValue(makeConversationResponse(asmMessages));
    const messages = await store.getMessages('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls![0].status).toBe('error');
    expect(messages[0].toolCalls![0].error).toBe('ENOENT: no such file');
    expect(messages[0].toolCalls![0].toolResult).toBeUndefined();
  });

  it('should preserve origin on round-trip and not duplicate it into public metadata', async function originRoundTrip() {
    await store.addMessage('conv-1', 'user', 'support reply', { origin: 'support' });
    const sent = mockClient.addMessages.mock.calls[0]![1][0];
    expect(sent.metadata.origin).toBe('support');

    const asmMessages = [
      {
        id: sent.id,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
        contents: [{ typename: 'TextContent', text: 'support reply' }],
        participant: { id: 'user', type: ParticipantType.User },
        metadata: { conversationId: 'conv-1', origin: 'support' },
      },
    ];
    mockClient.getConversation.mockResolvedValue(makeConversationResponse(asmMessages));
    const messages = await store.getMessages('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].origin).toBe('support');
    expect(messages[0].metadata?.origin).toBeUndefined();
  });

  it('should surface the ASM message id (= original SQLite id) on getMessagesForHistory', async function historyIdsAreSqlite() {
    const asmMessages = [
      {
        id: 'sqlite-id-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
        contents: [{ typename: 'TextContent', text: 'first' }],
        participant: { id: 'user', type: ParticipantType.User },
        metadata: { conversationId: 'conv-1' },
      },
      {
        id: 'sqlite-id-2',
        createdAt: new Date('2024-01-01T00:00:01Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:01Z'),
        contents: [{ typename: 'TextContent', text: 'second' }],
        participant: { id: 'agent', type: ParticipantType.Agent },
        responseTo: ['sqlite-id-1'],
        metadata: { conversationId: 'conv-1' },
      },
    ];
    mockClient.getConversation.mockResolvedValue(makeConversationResponse(asmMessages));

    const history = await store.getMessagesForHistory('conv-1');
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe('sqlite-id-1');
    expect(history[1].id).toBe('sqlite-id-2');
  });

  it('should buffer streaming chunks and flush once on finalize', async function streamingChunksDoNotFlush() {
    // Standalone mode accumulates streaming updates in the in-progress buffer and
    // flushes only when the turn is finalized (inProgress: false).
    const msg = await store.addMessage('conv-1', 'agent', '', {
      metadata: { inProgress: true },
    });
    await store.updateMessage(msg.id, { content: 'chunk-1' });
    await store.updateMessage(msg.id, { content: 'chunk-1 chunk-2' });
    expect(mockClient.addMessages).not.toHaveBeenCalled();

    await store.updateMessage(msg.id, {
      content: 'final',
      metadata: { inProgress: false, outcome: 'complete' },
    });
    expect(mockClient.addMessages).toHaveBeenCalledTimes(1);
  });

  it('should round-trip stats from metadata into AsmStatsInput and back into metadata', async function statsRoundTrip() {
    await store.addMessage('conv-1', 'agent', 'answer', {
      metadata: {
        inputTokens: 120,
        outputTokens: 45,
        latency: 850,
        stopReason: 'end_turn',
      },
    });

    const sent = mockClient.addMessages.mock.calls[0]![1][0];
    expect(sent.stats).toBeDefined();
    expect(sent.stats.latency).toBe(850);
    expect(sent.stats.modelUsage.tokens).toEqual({ input: 120, output: 45 });
    expect(sent.stats.modelUsage.stopReason).toBe('end_turn');

    const asmMessages = [
      {
        id: sent.id,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        messageCreatedAt: new Date('2024-01-01T00:00:00Z'),
        contents: [{ typename: 'TextContent', text: 'answer' }],
        participant: { id: 'agent', type: ParticipantType.Agent },
        metadata: { conversationId: 'conv-1' },
        stats: {
          latency: 850,
          modelUsage: {
            tokens: { input: 120, output: 45 },
            stopReason: 'end_turn',
          },
        },
      },
    ];
    mockClient.getConversation.mockResolvedValue(makeConversationResponse(asmMessages));
    const messages = await store.getMessages('conv-1');
    expect(messages[0].metadata).toMatchObject({
      latency: 850,
      inputTokens: 120,
      outputTokens: 45,
      stopReason: 'end_turn',
    });
  });
});
