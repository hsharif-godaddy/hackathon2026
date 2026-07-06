import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevSupervisorError } from '../DevSupervisorClient.js';

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));
vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: { create: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { MemoryService } from '../memory-service.js';
import { createForWorkspace } from '../../workspace/index.js';
import { createStubWorkspaceFiles } from '../../workspace/__tests__/test-workspace-files.js';

describe('MemoryService.list error handling', () => {
  let service: MemoryService;
  let mockTree: ReturnType<typeof vi.fn>;
  let mockReadText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTree = vi.fn();
    mockReadText = vi.fn();
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({ tree: mockTree, readText: mockReadText }),
    } as any);
    service = new MemoryService();
  });

  it('should return empty array when tree throws DevSupervisorError not_found', async () => {
    mockTree.mockRejectedValue(new DevSupervisorError('not_found', 404, 'directory not found'));

    const result = await service.list('app-123');
    expect(result).toEqual([]);
  });

  it('should propagate non-not-found errors from tree', async () => {
    mockTree.mockRejectedValue(new Error('connection refused'));

    await expect(service.list('app-123')).rejects.toThrow('connection refused');
  });

  it('should skip entries that throw DevSupervisorError not_found on readText', async () => {
    mockTree.mockResolvedValue({
      entries: [
        { kind: 'file', path: '.memory/ns/key1.md' },
        { kind: 'file', path: '.memory/ns/key2.md' },
      ],
    });
    mockReadText
      .mockRejectedValueOnce(new DevSupervisorError('not_found', 404, 'file gone'))
      .mockResolvedValueOnce('---\nkey: ns/key2\nnamespace: ns\n---\nvalue content');

    const result = await service.list('app-123');
    expect(result).toHaveLength(1);
  });

  it('should propagate non-not-found errors from per-entry readText', async () => {
    mockTree.mockResolvedValue({
      entries: [{ kind: 'file', path: '.memory/ns/key1.md' }],
    });
    mockReadText.mockRejectedValue(new Error('supervisor unavailable'));

    await expect(service.list('app-123')).rejects.toThrow('supervisor unavailable');
  });
});
