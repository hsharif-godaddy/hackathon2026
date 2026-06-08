import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn(function ConversationRepository() {
    return {};
  }),
}));

vi.mock('../sqlite/sqlite-conversation-store.js', () => ({
  SqliteConversationLifecycleStore: vi.fn(function SqliteConversationLifecycleStore() {
    return { _kind: 'sqlite-lifecycle' };
  }),
  SqliteMessageStore: vi.fn(function SqliteMessageStore() {
    return { _kind: 'sqlite-message' };
  }),
  SqliteConversationTokenStore: vi.fn(function SqliteConversationTokenStore() {
    return { _kind: 'sqlite-token' };
  }),
}));

vi.mock('../sqlite/sqlite-kv-memory-store.js', () => ({
  SqliteKvMemoryStore: vi.fn(function SqliteKvMemoryStore() {
    return { _kind: 'sqlite-kv' };
  }),
}));

vi.mock('../sqlite/sqlite-summary-store.js', () => ({
  SqliteSummaryStore: vi.fn(function SqliteSummaryStore() {
    return { _kind: 'sqlite-summary' };
  }),
}));

const asmFactoryMocks = {
  getAsmConversationLifecycleStore: vi.fn(),
  getAsmMessageStore: vi.fn(),
  getAsmConversationTokenStore: vi.fn(),
};

vi.mock('../asm/index.js', () => asmFactoryMocks);

vi.mock('../asm/dual-write-stores.js', () => ({
  DualWriteConversationLifecycleStore: vi.fn(function DualWriteConversationLifecycleStore() {
    return { _kind: 'dualwrite-lifecycle' };
  }),
  DualWriteMessageStore: vi.fn(function DualWriteMessageStore() {
    return { _kind: 'dualwrite-message' };
  }),
}));

describe('adapters/index dual-write construction', function dualWriteConstructionTests() {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(function setup() {
    originalEnv = { ...process.env };
    delete process.env.AIRO_STANDALONE;
    delete process.env.USE_ASM_MEMORY;
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(function teardown() {
    process.env = originalEnv;
  });

  it('should fall back to SQLite stores when ASM construction throws and remember the failure', async function constructionFailure() {
    asmFactoryMocks.getAsmConversationLifecycleStore.mockImplementation(() => {
      throw new Error('ASM_BASE_URL not set');
    });
    asmFactoryMocks.getAsmMessageStore.mockImplementation(() => {
      throw new Error('ASM_BASE_URL not set');
    });

    const { getConversationLifecycleStore, getMessageStore, getSummaryStore } = await import('../index.js');

    expect((getConversationLifecycleStore() as unknown as { _kind: string })._kind).toBe('sqlite-lifecycle');
    expect((getMessageStore() as unknown as { _kind: string })._kind).toBe('sqlite-message');
    expect((getSummaryStore() as unknown as { _kind: string })._kind).toBe('sqlite-summary');

    // After the first failure, the sticky flag should short-circuit subsequent
    // factory calls — only the lifecycle factory ran (the first one tried).
    expect(asmFactoryMocks.getAsmConversationLifecycleStore).toHaveBeenCalledTimes(1);
    expect(asmFactoryMocks.getAsmMessageStore).not.toHaveBeenCalled();
  });

  it('should compose dual-write stores when ASM construction succeeds', async function constructionSuccess() {
    asmFactoryMocks.getAsmConversationLifecycleStore.mockReturnValue({ _kind: 'asm-lifecycle' });
    asmFactoryMocks.getAsmMessageStore.mockReturnValue({ _kind: 'asm-message' });

    const { getConversationLifecycleStore, getMessageStore, getSummaryStore } = await import('../index.js');

    expect((getConversationLifecycleStore() as unknown as { _kind: string })._kind).toBe('dualwrite-lifecycle');
    expect((getMessageStore() as unknown as { _kind: string })._kind).toBe('dualwrite-message');
    // Summary store stays SQLite-only (no ASM mirror today).
    expect((getSummaryStore() as unknown as { _kind: string })._kind).toBe('sqlite-summary');
  });

  it('should return ASM stores when USE_ASM_MEMORY is set (deployment topology)', async function asmOnly() {
    process.env.USE_ASM_MEMORY = 'true';
    asmFactoryMocks.getAsmConversationLifecycleStore.mockReturnValue({ _kind: 'asm-lifecycle' });
    asmFactoryMocks.getAsmMessageStore.mockReturnValue({ _kind: 'asm-message' });
    asmFactoryMocks.getAsmConversationTokenStore.mockReturnValue({ _kind: 'asm-token' });

    const { getConversationLifecycleStore, getMessageStore, getConversationTokenStore } = await import('../index.js');

    expect((getConversationLifecycleStore() as unknown as { _kind: string })._kind).toBe('asm-lifecycle');
    expect((getMessageStore() as unknown as { _kind: string })._kind).toBe('asm-message');
    expect((getConversationTokenStore() as unknown as { _kind: string })._kind).toBe('asm-token');
  });
});
