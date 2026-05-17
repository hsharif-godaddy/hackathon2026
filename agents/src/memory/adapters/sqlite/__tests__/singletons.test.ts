import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../database/connection.js', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
  })),
}));

vi.mock('../../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('memory adapter singletons', function singletonTests() {
  it('should return the same instance on repeated calls', async function identity() {
    const { getConversationLifecycleStore, getMessageStore, getConversationTokenStore, getKvMemoryStore, getSummaryStore } = await import('../../index.js');

    expect(getConversationLifecycleStore()).toBe(getConversationLifecycleStore());
    expect(getMessageStore()).toBe(getMessageStore());
    expect(getConversationTokenStore()).toBe(getConversationTokenStore());
    expect(getKvMemoryStore()).toBe(getKvMemoryStore());
    expect(getSummaryStore()).toBe(getSummaryStore());
  });
});
