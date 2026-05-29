import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../database/connection.js', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn(),
  })),
}));

vi.mock('../../logging/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../logging/events/index.js', () => ({
  appCleanupEvents: { directorySuccess: vi.fn() },
}));

vi.mock('../../utils/error.js', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: class {},
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn() },
}));

const { mockFindById, mockGetContextString } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockGetContextString: vi.fn(),
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class { findById = mockFindById; },
}));

vi.mock('../../services/memory-singletons.js', () => ({
  memoryService: {},
  memorySchemaRegistry: {},
  memoryContextProvider: { getContextString: mockGetContextString },
}));

vi.mock('@langfuse/tracing', () => ({
  observe: (fn: unknown) => fn,
  updateActiveObservation: vi.fn(),
}));

vi.mock('../../tools/ai-lib-tools/drivers/knowb-driver.js', () => ({
  knowBDriver: { search: vi.fn(), formatResultsAsMarkdown: vi.fn() },
}));

import { buildMemoryContextMessage } from '../context-builders.js';

describe('buildMemoryContextMessage', () => {
  beforeEach(() => {
    mockGetContextString.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when appId is empty', async () => {
    const result = await buildMemoryContextMessage({ appId: '' });
    expect(result).toBeNull();
    expect(mockGetContextString).not.toHaveBeenCalled();
  });

  it('returns null when contextString is empty', async () => {
    mockGetContextString.mockResolvedValueOnce('');
    const result = await buildMemoryContextMessage({ appId: 'app-1' });
    expect(result).toBeNull();
  });

  it('returns null when contextString is null', async () => {
    mockGetContextString.mockResolvedValueOnce(null);
    const result = await buildMemoryContextMessage({ appId: 'app-1' });
    expect(result).toBeNull();
  });

  it('returns context message when memory entries exist', async () => {
    const contextContent = '## Memory\n\napp.title: My App\napp.description: A test app';
    mockGetContextString.mockResolvedValueOnce(contextContent);

    const result = await buildMemoryContextMessage({ appId: 'app-1' });

    expect(result).toEqual({
      role: 'user',
      content: contextContent,
      insertionOrder: 'after_history',
    });
  });

  it('returns null and logs warning when provider throws', async () => {
    mockGetContextString.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await buildMemoryContextMessage({ appId: 'app-1' });
    expect(result).toBeNull();
    const { logger } = await import('../../logging/index.js');
    expect(logger.warn).toHaveBeenCalledWith(
      'context.memory.build_failed',
      expect.objectContaining({ appId: 'app-1', error: 'DB connection failed' })
    );
  });
});
