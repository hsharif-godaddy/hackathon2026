import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Conversation, ConversationMessage } from '../../../../database/schema.js';
import type { WorkspaceScope } from '../../../interfaces/scope.js';
import {
  DualWriteConversationLifecycleStore,
  DualWriteMessageStore,
} from '../dual-write-stores.js';
import type { AsmConversationLifecycleStore } from '../asm-conversation-store.js';
import type { AsmMessageStore } from '../asm-message-store.js';
import { AsmConversationNotFoundError } from '../asm-message-store.js';
import { logger } from '../../../../logging/index.js';
import { runWithAgentContext } from '../../../../lib/agent-context-storage.js';
import type { AgentContext } from '../../../../server/middleware/jwt-auth.js';

const ctxWith = (asmDualWriteEnabled: boolean): AgentContext => ({
  siteId: 'test-site',
  canDownload: true,
  canPublish: true,
  isE2S: false,
  product: 'AiroAppBuilder',
  asmDualWriteEnabled,
  exp: 0,
  iat: 0,
});

const scope: WorkspaceScope = { kind: 'resolved', appId: 'app-1', customerId: 'cust-1' };
const VALID_CUSTOMER_UUID = '11111111-1111-4111-8111-111111111111';

describe('dual-write ASM stores', function dualWriteStoreTests() {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(function setup() {
    originalEnv = { ...process.env };
    process.env.ASM_DUALWRITE_ENABLED = 'true';
  });

  afterEach(function teardown() {
    process.env = originalEnv;
  });

  it('should return the SQLite conversation and mirror create with the same id', async function createConversation() {
    const conversation = makeConversation();
    const primary = {
      create: vi.fn().mockResolvedValue(conversation),
    };
    const asm = {
      create: vi.fn().mockResolvedValue(makeConversation()),
    };
    const store = new DualWriteConversationLifecycleStore(
      primary as never,
      asm as unknown as AsmConversationLifecycleStore
    );

    await expect(store.create(scope, 'agent-1', 'Title')).resolves.toBe(conversation);
    await flushPromises();

    expect(primary.create).toHaveBeenCalledWith(scope, 'agent-1', 'Title', undefined);
    expect(asm.create).toHaveBeenCalledWith(scope, 'agent-1', 'Title', conversation.id);
  });

  it('should mirror a user message to ASM with the SQLite snapshot (terminal on arrival)', async function userUpsert() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user', content: 'hello' });
    const primary = {
      addMessage: vi.fn().mockResolvedValue(message),
    };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await expect(
      store.addMessage('conv-1', 'user', 'hello', { customerId: VALID_CUSTOMER_UUID })
    ).resolves.toBe(message);
    await flushPromises();

    expect(primary.addMessage).toHaveBeenCalledWith('conv-1', 'user', 'hello', {
      customerId: VALID_CUSTOMER_UUID,
    });
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(1);
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: message.id, sender: 'user', content: 'hello', origin: 'customer' }),
      expect.objectContaining({ customerId: VALID_CUSTOMER_UUID })
    );
  });

  it('should mirror addMessage when JWT claim opts in (env unset)', async function jwtClaimEnables() {
    delete process.env.ASM_DUALWRITE_ENABLED;
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user', content: 'hello' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await runWithAgentContext(ctxWith(true), async () => {
      await store.addMessage('conv-1', 'user', 'hello', { customerId: VALID_CUSTOMER_UUID });
      await flushPromises();
    });

    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: message.id, sender: 'user', content: 'hello' }),
      expect.objectContaining({ customerId: VALID_CUSTOMER_UUID })
    );
  });

  it('should not mirror addMessage when dual-write is disabled', async function disabledNoMirror() {
    delete process.env.ASM_DUALWRITE_ENABLED;
    const message = makeMessage({ id: 'sqlite-msg-1' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'user', 'hello', { customerId: VALID_CUSTOMER_UUID });
    await flushPromises();

    expect(asm.mirrorCompleteMessage).not.toHaveBeenCalled();
  });

  it('should skip user mirror when customerId is missing', async function skipUserNoCustomerId() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'user', 'hello');
    await flushPromises();

    expect(primary.addMessage).toHaveBeenCalledTimes(1);
    expect(asm.mirrorCompleteMessage).not.toHaveBeenCalled();
  });

  it('should skip user mirror when customerId is not a UUID', async function skipUserNonUuidCustomerId() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'user', 'hello', { customerId: 'not-a-uuid' });
    await flushPromises();

    expect(asm.mirrorCompleteMessage).not.toHaveBeenCalled();
  });

  it('should mirror a user message using the agent-context customerId when no explicit option is given', async function userMirrorContextFallback() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user', content: 'hello' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    // No explicit options.customerId — the valid customerId lives only in the
    // ambient agent context. The guard must validate the resolved value.
    await runWithAgentContext({ ...ctxWith(true), customerId: VALID_CUSTOMER_UUID }, async () => {
      await store.addMessage('conv-1', 'user', 'hello');
      await flushPromises();
    });

    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: message.id, sender: 'user', content: 'hello' }),
      expect.objectContaining({ customerId: VALID_CUSTOMER_UUID })
    );
  });

  it('should not mirror an in-progress agent placeholder (mirror waits for finalize)', async function skipInProgressPlaceholder() {
    // The dual-write layer only mirrors finalized snapshots — never the empty
    // placeholder or streaming chunks. The placeholder is skipped here.
    const placeholder = makeMessage({
      id: 'agent-placeholder',
      sender: 'agent',
      content: '',
      metadata: { inProgress: true },
    });
    const primary = { addMessage: vi.fn().mockResolvedValue(placeholder) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'agent', '', { metadata: { inProgress: true } });
    await flushPromises();

    expect(primary.addMessage).toHaveBeenCalledTimes(1);
    expect(asm.mirrorCompleteMessage).not.toHaveBeenCalled();
  });

  it('should mirror a terminal agent message without a customerId guard', async function mirrorAgentTerminal() {
    const message = makeMessage({ id: 'agent-msg-1', sender: 'agent', content: 'reply', origin: 'support' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'agent', 'reply');
    await flushPromises();

    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: message.id, sender: 'agent', content: 'reply' }),
      expect.objectContaining({})
    );
  });

  it('should derive the agent id from metadata.agentId in the participant context', async function fallbackAgentIdFromMetadata() {
    const message = makeMessage({
      id: 'agent-fallback',
      sender: 'agent',
      content: 'reply',
      origin: 'support',
      metadata: { agentId: 'develop' },
    });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'agent', 'reply', { agentId: 'develop' });
    await flushPromises();

    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: message.id, sender: 'agent', content: 'reply' }),
      expect.objectContaining({ agentId: 'develop' })
    );
  });

  it('should wait for a pending conversation create before mirroring its first message', async function createBeforeMessage() {
    const conversation = makeConversation();
    let resolveCreate!: () => void;
    const lifecyclePrimary = {
      create: vi.fn().mockResolvedValue(conversation),
      getById: vi.fn().mockResolvedValue(conversation),
    };
    const asmLifecycle = {
      create: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveCreate = resolve;
      })),
    };
    const lifecycleStore = new DualWriteConversationLifecycleStore(
      lifecyclePrimary as never,
      asmLifecycle as unknown as AsmConversationLifecycleStore
    );

    const message = makeMessage({ id: 'first-message', sender: 'user', content: 'hello' });
    const messagePrimary = {
      addMessage: vi.fn().mockResolvedValue(message),
    };
    const asmMessage = makeAsmMessageMock();
    const messageStore = new DualWriteMessageStore(
      messagePrimary as never,
      asmMessage as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await lifecycleStore.create(scope, 'agent-1', 'Title');
    await messageStore.addMessage('conv-1', 'user', 'hello', { customerId: VALID_CUSTOMER_UUID });
    await flushPromises();

    expect(asmMessage.mirrorCompleteMessage).not.toHaveBeenCalled();
    resolveCreate();
    await flushPromises();

    expect(asmMessage.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ id: message.id, sender: 'user', content: 'hello' }),
      expect.objectContaining({ customerId: VALID_CUSTOMER_UUID })
    );
  });

  it('should not mirror a streaming updateMessage while the row is still in progress', async function streamingUpdateSkips() {
    const inProgressRow = makeMessage({
      id: 'agent-1',
      sender: 'agent',
      content: 'partial',
      metadata: { inProgress: true },
    });
    const primary = {
      updateMessage: vi.fn().mockResolvedValue(undefined),
      getMessageById: vi.fn().mockResolvedValue(inProgressRow),
    };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.updateMessage('agent-1', { content: 'partial' });
    await flushPromises();

    expect(primary.updateMessage).toHaveBeenCalledWith('agent-1', { content: 'partial' });
    expect(asm.mirrorCompleteMessage).not.toHaveBeenCalled();
  });

  it('should mirror the full row on the finalize updateMessage', async function finalizeUpserts() {
    const finalRow = makeMessage({
      id: 'agent-1',
      sender: 'agent',
      content: 'final',
      origin: 'support',
      metadata: { inProgress: false, outcome: 'complete', agentId: 'develop' },
    });
    const primary = {
      updateMessage: vi.fn().mockResolvedValue(undefined),
      getMessageById: vi.fn().mockResolvedValue(finalRow),
    };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.updateMessage('agent-1', {
      content: 'final',
      metadata: { inProgress: false, outcome: 'complete' },
    });
    await flushPromises();

    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(1);
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        id: 'agent-1',
        content: 'final',
        metadata: expect.objectContaining({ outcome: 'complete' }),
      }),
      expect.objectContaining({ agentId: 'develop' })
    );
  });

  it('should re-mirror the full row on a post-finalize metadata patch', async function patchReUpserts() {
    const patchedRow = makeMessage({
      id: 'agent-1',
      sender: 'agent',
      content: 'final',
      origin: 'support',
      metadata: { inProgress: false, outcome: 'complete', commitHash: 'abc123' },
    });
    const primary = {
      updateMessageMetadata: vi.fn().mockResolvedValue(undefined),
      getMessageById: vi.fn().mockResolvedValue(patchedRow),
    };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.updateMessageMetadata('agent-1', { commitHash: 'abc123' });
    await flushPromises();

    expect(primary.updateMessageMetadata).toHaveBeenCalledWith('agent-1', { commitHash: 'abc123' });
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        id: 'agent-1',
        content: 'final',
        metadata: expect.objectContaining({ commitHash: 'abc123' }),
      }),
      expect.objectContaining({})
    );
  });

  it('should land the late metadata patch LAST on the wire, after the finalize write', async function patchLandsLast() {
    // Regression guard for the finalize/late-patch [Critical]: a stale finalize
    // mirror must never overwrite a later commitHash patch. The global FIFO mirror
    // queue guarantees the patch is the last write to reach ASM — assert on call
    // ORDER, not just that the patched write was emitted.
    const finalRow = makeMessage({
      id: 'agent-1',
      sender: 'agent',
      content: 'final',
      origin: 'support',
      metadata: { inProgress: false, outcome: 'complete' },
    });
    const patchedRow = makeMessage({
      id: 'agent-1',
      sender: 'agent',
      content: 'final',
      origin: 'support',
      metadata: { inProgress: false, outcome: 'complete', commitHash: 'abc123' },
    });
    const primary = {
      updateMessage: vi.fn().mockResolvedValue(undefined),
      updateMessageMetadata: vi.fn().mockResolvedValue(undefined),
      // First read (finalize) returns the pre-patch row; second read (patch)
      // returns the row carrying commitHash.
      getMessageById: vi
        .fn()
        .mockResolvedValueOnce(finalRow)
        .mockResolvedValueOnce(patchedRow),
    };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    // Finalize, then a post-finalize metadata patch — same message/conversation.
    await store.updateMessage('agent-1', {
      content: 'final',
      metadata: { inProgress: false, outcome: 'complete' },
    });
    await store.updateMessageMetadata('agent-1', { commitHash: 'abc123' });
    await flushPromises();

    const calls = asm.mirrorCompleteMessage.mock.calls;
    expect(calls).toHaveLength(2);
    // mirrorCompleteMessage signature: (conversationId, message, participantContext).
    // The FIRST mirror is the finalize (no commitHash yet)...
    expect(calls[0]![1].metadata).not.toHaveProperty('commitHash');
    // ...and the LAST mirror carries the patch — proving wire order.
    expect(calls[calls.length - 1]![1].metadata).toMatchObject({ commitHash: 'abc123' });
  });

  it('should forward deleteMessage to both stores after looking up the conversation', async function deleteForwards() {
    const stored = makeMessage({ id: 'msg-del' });
    const primary = {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      getMessageById: vi.fn().mockResolvedValue(stored),
    };
    const asm = makeAsmMessageMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await store.deleteMessage('msg-del');
    await flushPromises();

    expect(primary.deleteMessage).toHaveBeenCalledWith('msg-del');
    expect(asm.deleteMessage).toHaveBeenCalledWith('msg-del');
  });

  it('should keep SQLite success even when the ASM mirror fails', async function mirrorFailureNonBlocking() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user', content: 'hello' });
    const primary = {
      addMessage: vi.fn().mockResolvedValue(message),
    };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage.mockRejectedValueOnce(new Error('ASM down'));
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await expect(
      store.addMessage('conv-1', 'user', 'hello', { customerId: VALID_CUSTOMER_UUID })
    ).resolves.toBe(message);
    await flushPromises();

    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(1);
  });

  it('should still forward messages to ASM after the create mirror failed, in create-then-message order', async function forwardsAfterFailedCreate() {
    // Multiplex contract: SQLite is the source of truth and every terminal write
    // is mirrored. A failed conversation-create mirror does not suppress later
    // message mirrors — they run (best-effort) on the shared ordered queue, so
    // create is always attempted before its messages.
    const failedConversationId = 'conv-g2-fail';
    const conversation = makeConversation({ id: failedConversationId });
    const order: string[] = [];
    const lifecyclePrimary = {
      create: vi.fn().mockResolvedValue(conversation),
      getById: vi.fn().mockResolvedValue(conversation),
    };
    const asmLifecycle = {
      create: vi.fn().mockImplementation(() => {
        order.push('create');
        return Promise.reject(new Error('asm down'));
      }),
    };
    const lifecycleStore = new DualWriteConversationLifecycleStore(
      lifecyclePrimary as never,
      asmLifecycle as unknown as AsmConversationLifecycleStore
    );

    const messagePrimary = {
      addMessage: vi
        .fn()
        .mockResolvedValueOnce(
          makeMessage({ id: 'msg-a', sender: 'agent', content: 'first', conversationId: failedConversationId })
        )
        .mockResolvedValueOnce(
          makeMessage({ id: 'msg-b', sender: 'agent', content: 'second', conversationId: failedConversationId })
        ),
    };
    const asmMessage = makeAsmMessageMock();
    asmMessage.mirrorCompleteMessage.mockImplementation(() => {
      order.push('message');
      return Promise.resolve(undefined);
    });
    const messageStore = new DualWriteMessageStore(
      messagePrimary as never,
      asmMessage as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    await lifecycleStore.create(scope, 'agent-1', 'Title');
    await messageStore.addMessage(failedConversationId, 'agent', 'first');
    await messageStore.addMessage(failedConversationId, 'agent', 'second');
    await flushPromises();
    await flushPromises();

    expect(asmMessage.mirrorCompleteMessage).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['create', 'message', 'message']);
  });

  it('should escalate to logger.error when the ASM mirror throws a programmer error', async function programmerErrorEscalates() {
    const message = makeMessage({ id: 'msg-g1', sender: 'agent' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage.mockRejectedValueOnce(new TypeError('bad input'));
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      makeSqliteLifecycleMock() as never,
      makeAsmLifecycleMock() as unknown as AsmConversationLifecycleStore
    );

    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    try {
      await store.addMessage('conv-g1', 'agent', 'hello');
      await flushPromises();

      const errorCalls = errorSpy.mock.calls.filter(
        ([event]) => event === 'asm.dualwrite.write.failure'
      );
      const warnCalls = warnSpy.mock.calls.filter(
        ([event]) => event === 'asm.dualwrite.write.failure'
      );
      expect(errorCalls).toHaveLength(1);
      expect(warnCalls).toHaveLength(0);
      expect(errorCalls[0]?.[1]).toMatchObject({
        operation: 'message.upsert',
        errorClass: 'unknown',
      });
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('should recreate the ASM conversation from SQLite and retry when ASM reports it missing', async function recreateOnMissing() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'user', content: 'hello' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage
      .mockRejectedValueOnce(new AsmConversationNotFoundError('conv-1'))
      .mockResolvedValueOnce(undefined);
    const sqliteConversations = makeSqliteLifecycleMock(
      makeConversation({ id: 'conv-1', appId: 'app-1', agentId: 'develop', title: 'My App' })
    );
    const asmConversations = makeAsmLifecycleMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      sqliteConversations as never,
      asmConversations as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'user', 'hello', { customerId: VALID_CUSTOMER_UUID });
    await flushPromises();

    expect(sqliteConversations.getById).toHaveBeenCalledWith('conv-1');
    // Recreated with the SQLite record's appId/agentId/title and the SAME id,
    // scoped to the customer from the message mirror.
    expect(asmConversations.create).toHaveBeenCalledWith(
      { kind: 'resolved', appId: 'app-1', customerId: VALID_CUSTOMER_UUID },
      'develop',
      'My App',
      'conv-1'
    );
    // Message is retried once after the conversation is recreated.
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(2);
  });

  it('should give up after one recreate retry and continue later mirrors', async function boundedRecreateRetry() {
    const primary = {
      addMessage: vi
        .fn()
        .mockResolvedValueOnce(
          makeMessage({ id: 'msg-first', sender: 'agent', content: 'first' })
        )
        .mockResolvedValueOnce(
          makeMessage({ id: 'msg-second', sender: 'agent', content: 'second' })
        ),
    };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage
      .mockRejectedValueOnce(new AsmConversationNotFoundError('conv-1'))
      .mockRejectedValueOnce(new AsmConversationNotFoundError('conv-1'))
      .mockResolvedValueOnce(undefined);
    const sqliteConversations = makeSqliteLifecycleMock(
      makeConversation({ id: 'conv-1', appId: 'app-1', agentId: 'develop', title: 'My App' })
    );
    const asmConversations = makeAsmLifecycleMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      sqliteConversations as never,
      asmConversations as unknown as AsmConversationLifecycleStore
    );
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    try {
      await store.addMessage('conv-1', 'agent', 'first');
      await store.addMessage('conv-1', 'agent', 'second');
      await flushPromises();
      await flushPromises();

      expect(sqliteConversations.getById).toHaveBeenCalledTimes(1);
      expect(asmConversations.create).toHaveBeenCalledTimes(1);
      expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(3);
      const errorCalls = errorSpy.mock.calls.filter(
        ([event]) => event === 'asm.dualwrite.write.failure'
      );
      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0]?.[1]).toMatchObject({
        operation: 'message.upsert',
        conversationId: 'conv-1',
        messageId: 'msg-first',
      });
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('should NOT recreate the conversation on a generic ASM failure', async function noRecreateOnGenericFailure() {
    const message = makeMessage({ id: 'sqlite-msg-1', sender: 'agent', content: 'reply' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage.mockRejectedValueOnce(new Error('ASM down'));
    const sqliteConversations = makeSqliteLifecycleMock();
    const asmConversations = makeAsmLifecycleMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      sqliteConversations as never,
      asmConversations as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'agent', 'reply');
    await flushPromises();

    expect(asmConversations.create).not.toHaveBeenCalled();
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(1);
  });

  it('should recreate with a local scope when no customerId is available', async function recreateLocalScope() {
    const message = makeMessage({ id: 'agent-msg-1', sender: 'agent', content: 'reply' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage
      .mockRejectedValueOnce(new AsmConversationNotFoundError('conv-1'))
      .mockResolvedValueOnce(undefined);
    const sqliteConversations = makeSqliteLifecycleMock(
      makeConversation({ id: 'conv-1', appId: 'app-1', agentId: 'develop' })
    );
    const asmConversations = makeAsmLifecycleMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      sqliteConversations as never,
      asmConversations as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'agent', 'reply');
    await flushPromises();

    expect(asmConversations.create).toHaveBeenCalledWith(
      { kind: 'local', appId: 'app-1' },
      'develop',
      'Title',
      'conv-1'
    );
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(2);
  });

  it('should give up (no retry) when SQLite has no record for the missing conversation', async function noSqliteRecord() {
    const message = makeMessage({ id: 'agent-msg-1', sender: 'agent', content: 'reply' });
    const primary = { addMessage: vi.fn().mockResolvedValue(message) };
    const asm = makeAsmMessageMock();
    asm.mirrorCompleteMessage.mockRejectedValueOnce(new AsmConversationNotFoundError('conv-1'));
    const sqliteConversations = makeSqliteLifecycleMock(null);
    const asmConversations = makeAsmLifecycleMock();
    const store = new DualWriteMessageStore(
      primary as never,
      asm as unknown as AsmMessageStore,
      sqliteConversations as never,
      asmConversations as unknown as AsmConversationLifecycleStore
    );

    await store.addMessage('conv-1', 'agent', 'reply');
    await flushPromises();

    expect(asmConversations.create).not.toHaveBeenCalled();
    // Only the initial attempt — no retry without a source record.
    expect(asm.mirrorCompleteMessage).toHaveBeenCalledTimes(1);
  });
});

function makeAsmMessageMock(): {
  mirrorCompleteMessage: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
} {
  return {
    mirrorCompleteMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSqliteLifecycleMock(
  conversation: Conversation | null = makeConversation()
): { getById: ReturnType<typeof vi.fn> } {
  return { getById: vi.fn().mockResolvedValue(conversation) };
}

function makeAsmLifecycleMock(): { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn().mockResolvedValue(undefined) };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    appId: 'app-1',
    agentId: 'agent-1',
    title: 'Title',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    sender: 'user',
    content: 'hello',
    origin: 'customer',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
