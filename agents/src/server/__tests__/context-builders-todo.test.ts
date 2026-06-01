import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class { findById = vi.fn() },
}));

vi.mock('../../tools/ai-lib-tools/drivers/knowb-driver.js', () => ({
  knowBDriver: { search: vi.fn() },
}));

vi.mock('../../services/memory-singletons.js', () => ({
  memoryContextProvider: { getContextString: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@langfuse/tracing', () => ({
  observe: vi.fn(),
  updateActiveObservation: vi.fn(),
}));

vi.mock('@airo/ai-grants', () => ({
  BudgetOverride: class {},
}));

const { mockGetCurrentIncompleteList, mockGenerateTodoContext } = vi.hoisted(() => ({
  mockGetCurrentIncompleteList: vi.fn(),
  mockGenerateTodoContext: vi.fn(),
}));

vi.mock('../../services/TodoContextManager.js', () => ({
  getTodoContextManager: () => ({
    getCurrentIncompleteList: mockGetCurrentIncompleteList,
    generateTodoContext: mockGenerateTodoContext,
  }),
}));

vi.mock('../../utils/todo-list-id-from-context-attachments.js', () => ({
  todoListIdFromContextAttachments: (attachments: unknown) => {
    if (!Array.isArray(attachments)) return undefined;
    const found = attachments.find((a: any) => a.type === 'todo_list_context');
    return found?.data?.id;
  },
}));

import { buildTodoContextMessage } from '../context-builders.js';

describe('buildTodoContextMessage — DB fallback', function todoFallbackTests() {
  const mockStateManager = {
    getSelectedTodoList: vi.fn(),
    setSelectedTodoList: vi.fn(),
  };

  beforeEach(function reset() {
    vi.clearAllMocks();
    mockGenerateTodoContext.mockResolvedValue('[Current Todo List]\n\nList: Test (ID: list-1)\nProgress: 2/6');
  });

  it('resolves from DB when no session selection and no attachment', async function resolvesFromDb() {
    mockStateManager.getSelectedTodoList.mockReturnValue(undefined);
    mockGetCurrentIncompleteList.mockResolvedValue({
      id: 'list-1',
      appId: 'app-1',
      name: 'Build Site',
      updatedAt: new Date(),
      items: [{ id: 'i1', completed: false }],
    });

    const result = await buildTodoContextMessage({
      sessionId: 'sess-1',
      appId: 'app-1',
      metadata: { appId: 'app-1' },
      contextAttachments: undefined,
      stateManager: mockStateManager,
    });

    expect(mockGetCurrentIncompleteList).toHaveBeenCalledWith('app-1');
    expect(mockStateManager.setSelectedTodoList).toHaveBeenCalledWith('sess-1', 'list-1');
    expect(mockGenerateTodoContext).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { appId: 'app-1' } }),
      'list-1'
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain('Todo List');
  });

  it('returns null when no incomplete lists exist', async function noIncompleteLists() {
    mockStateManager.getSelectedTodoList.mockReturnValue(undefined);
    mockGetCurrentIncompleteList.mockResolvedValue(null);

    const result = await buildTodoContextMessage({
      sessionId: 'sess-1',
      appId: 'app-1',
      metadata: { appId: 'app-1' },
      contextAttachments: undefined,
      stateManager: mockStateManager,
    });

    expect(result).toBeNull();
    expect(mockStateManager.setSelectedTodoList).not.toHaveBeenCalled();
    expect(mockGenerateTodoContext).not.toHaveBeenCalled();
  });

  it('skips DB lookup when session already has a selection', async function skipsDbWhenSessionHasSelection() {
    mockStateManager.getSelectedTodoList.mockReturnValue('existing-list');

    const result = await buildTodoContextMessage({
      sessionId: 'sess-1',
      appId: 'app-1',
      metadata: { appId: 'app-1' },
      contextAttachments: undefined,
      stateManager: mockStateManager,
    });

    expect(mockGetCurrentIncompleteList).not.toHaveBeenCalled();
    expect(mockGenerateTodoContext).toHaveBeenCalledWith(
      expect.anything(),
      'existing-list'
    );
    expect(result).not.toBeNull();
  });

  it('skips DB lookup when attachment provides list ID', async function skipsDbWhenAttachment() {
    mockStateManager.getSelectedTodoList.mockReturnValue(undefined);

    const result = await buildTodoContextMessage({
      sessionId: 'sess-1',
      appId: 'app-1',
      metadata: { appId: 'app-1' },
      contextAttachments: [{ type: 'todo_list_context', data: { id: 'attach-list' } }],
      stateManager: mockStateManager,
    });

    expect(mockGetCurrentIncompleteList).not.toHaveBeenCalled();
    expect(mockStateManager.setSelectedTodoList).toHaveBeenCalledWith('sess-1', 'attach-list');
    expect(mockGenerateTodoContext).toHaveBeenCalledWith(
      expect.anything(),
      'attach-list'
    );
    expect(result).not.toBeNull();
  });

  it('returns null gracefully when DB lookup throws', async function dbErrorGraceful() {
    mockStateManager.getSelectedTodoList.mockReturnValue(undefined);
    mockGetCurrentIncompleteList.mockRejectedValue(new Error('SQLITE_BUSY'));

    const result = await buildTodoContextMessage({
      sessionId: 'sess-1',
      appId: 'app-1',
      metadata: { appId: 'app-1' },
      contextAttachments: undefined,
      stateManager: mockStateManager,
    });

    expect(result).toBeNull();
    expect(mockStateManager.setSelectedTodoList).not.toHaveBeenCalled();
  });

  it('returns null when appId is missing', async function noAppId() {
    const result = await buildTodoContextMessage({
      sessionId: 'sess-1',
      appId: '',
      metadata: {},
      contextAttachments: undefined,
      stateManager: mockStateManager,
    });

    expect(result).toBeNull();
    expect(mockGetCurrentIncompleteList).not.toHaveBeenCalled();
  });
});
