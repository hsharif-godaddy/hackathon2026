import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../services/DevSupervisorClient.js', () => {
  class DevSupervisorError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    DevSupervisorError,
    isDevSupervisorNotFound: (err: unknown) =>
      err instanceof DevSupervisorError && (err as DevSupervisorError).code === 'not_found',
  };
});

vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

import { createForWorkspace } from '../../../../workspace/index.js';
import { DevSupervisorError } from '../../../../services/DevSupervisorClient.js';
import { createTool, deleteTool, getHistoryTool, listTool, updateTool } from '../index.js';

const mockCreateForWorkspace = vi.mocked(createForWorkspace);

function notFound(): DevSupervisorError {
  return new DevSupervisorError('not found', 'not_found');
}

function makeFiles(overrides?: Partial<ReturnType<typeof baseFiles>>) {
  return { ...baseFiles(), ...overrides };
}

function baseFiles() {
  return {
    readText: vi.fn<[{ path: string }], Promise<string>>(),
    write: vi.fn<[{ path: string; content: string }], Promise<{ bytesWritten: number }>>().mockResolvedValue({ bytesWritten: 0 }),
    tree: vi.fn(),
  };
}

function makeWorkspace(files = makeFiles()) {
  return { files };
}

const context = { metadata: { appId: 'app-123' } };

const VALID_UUID = 'a1b2c3d4-0000-4000-8000-000000000001';

function makeJobContent(name: string, description?: string, body = 'Do the thing.'): string {
  const desc = description ? `description: ${description}\n` : '';
  return `---\nname: ${name}\n${desc}---\n${body}\n`;
}

describe('automations tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('#create', () => {
    it('throws when appId is missing', async function missingAppId() {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      await expect(createTool.execute({ name: 'Test', body: 'Do it.' }, {})).rejects.toThrow('App ID required');
    });

    it('throws when workspace is unavailable', async function noWorkspace() {
      mockCreateForWorkspace.mockReturnValue(null);
      await expect(createTool.execute({ name: 'Test', body: 'Do it.' }, context)).rejects.toThrow('Workspace unavailable');
    });

    it('creates first automation (index not found → empty index)', async function firstCreate() {
      const files = makeFiles();
      files.readText.mockRejectedValue(notFound());
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await createTool.execute({ name: 'My Auto', body: 'Run checks.' }, context);

      expect(result.success).toBe(true);
      expect(result.name).toBe('My Auto');
      expect(typeof result.uuid).toBe('string');
      expect(result.uuid.length).toBeGreaterThan(0);
      // Writes job file
      expect(files.write).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining(result.uuid) }),
      );
      // Writes index with the new UUID
      expect(files.write).toHaveBeenCalledWith(
        expect.objectContaining({ path: '.airo/jobs/index.json', content: JSON.stringify([result.uuid]) }),
      );
    });

    it('appends to existing index on second create', async function secondCreate() {
      const existing = [VALID_UUID];
      const files = makeFiles();
      files.readText.mockResolvedValue(JSON.stringify(existing));
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await createTool.execute({ name: 'Second', body: 'Step 2.' }, context);

      expect(result.success).toBe(true);
      const writtenIndex = JSON.parse(
        (files.write.mock.calls.find(c => c[0].path === '.airo/jobs/index.json') as any)[0].content,
      ) as string[];
      expect(writtenIndex).toContain(VALID_UUID);
      expect(writtenIndex).toContain(result.uuid);
      expect(writtenIndex).toHaveLength(2);
    });

    it('tombstones job and throws when index JSON is corrupt', async function corruptIndex() {
      const files = makeFiles();
      files.readText.mockResolvedValue('NOT VALID JSON');
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await expect(createTool.execute({ name: 'X', body: 'Y' }, context)).rejects.toThrow('corrupt');

      // Job file must have been tombstoned (written empty)
      expect(files.write).toHaveBeenCalledWith(
        expect.objectContaining({ content: '' }),
      );
    });

    it('tombstones job and throws when index write fails', async function indexWriteFail() {
      const files = makeFiles();
      files.readText.mockRejectedValue(notFound()); // empty index
      files.write
        .mockResolvedValueOnce({ bytesWritten: 100 }) // job file write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // index write fails
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await expect(createTool.execute({ name: 'X', body: 'Y' }, context)).rejects.toThrow('index update failed');

      // Tombstone write must follow
      expect(files.write).toHaveBeenCalledWith(expect.objectContaining({ content: '' }));
    });
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe('#list', () => {
    it('returns empty automations when index does not exist', async function emptyIndex() {
      const files = makeFiles();
      files.readText.mockRejectedValue(notFound());
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await listTool.execute({}, context);

      expect(result.success).toBe(true);
      expect(result.automations).toEqual([]);
    });

    it('throws when index is corrupt', async function corruptIndex() {
      const files = makeFiles();
      files.readText.mockResolvedValue('bad json');
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await expect(listTool.execute({}, context)).rejects.toThrow('corrupt');
    });

    it('lists automations with name and description', async function normalList() {
      const uuid1 = VALID_UUID;
      const uuid2 = 'b2c3d4e5-0000-4000-8000-000000000002';
      const files = makeFiles();
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === '.airo/jobs/index.json') return JSON.stringify([uuid1, uuid2]);
        if (path.includes(uuid1)) return makeJobContent('First', 'Does A');
        if (path.includes(uuid2)) return makeJobContent('Second');
        throw notFound();
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await listTool.execute({}, context);

      expect(result.success).toBe(true);
      expect(result.automations).toHaveLength(2);
      expect(result.automations[0]).toEqual({ uuid: uuid1, name: 'First', description: 'Does A' });
      expect(result.automations[1]).toEqual({ uuid: uuid2, name: 'Second' });
    });

    it('silently skips tombstoned (empty) entries', async function tombstoned() {
      const files = makeFiles();
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === '.airo/jobs/index.json') return JSON.stringify([VALID_UUID]);
        return '';
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await listTool.execute({}, context);

      expect(result.automations).toEqual([]);
      expect(result.warnings).toBeUndefined();
    });

    it('adds warning for malformed entry with no name (not empty line numbers)', async function malformed() {
      const files = makeFiles();
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === '.airo/jobs/index.json') return JSON.stringify([VALID_UUID]);
        // Valid gray-matter but no name field
        return '---\ndescription: missing name\n---\nBody.';
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await listTool.execute({}, context);

      expect(result.automations).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('malformed (no name)');
    });

    it('adds warning for missing file (DevSupervisorNotFound)', async function missingFile() {
      const files = makeFiles();
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === '.airo/jobs/index.json') return JSON.stringify([VALID_UUID]);
        throw notFound();
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await listTool.execute({}, context);

      expect(result.automations).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('could not be read');
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe('#update', () => {
    it('throws when appId is missing', async function missingAppId() {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      await expect(updateTool.execute({ uuid: VALID_UUID, name: 'New' }, {})).rejects.toThrow('App ID required');
    });

    it('throws when automation is not found (404)', async function notFoundErr() {
      const files = makeFiles();
      files.readText.mockRejectedValue(notFound());
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await expect(updateTool.execute({ uuid: VALID_UUID }, context)).rejects.toThrow('not found');
    });

    it('throws when automation is tombstoned (empty file)', async function tombstoned() {
      const files = makeFiles();
      files.readText.mockResolvedValue('');
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await expect(updateTool.execute({ uuid: VALID_UUID }, context)).rejects.toThrow('not found');
    });

    it('updates name while preserving body and description', async function updateName() {
      const files = makeFiles();
      files.readText.mockResolvedValue(makeJobContent('Old Name', 'My desc', 'Original body.'));
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await updateTool.execute({ uuid: VALID_UUID, name: 'New Name' }, context);

      expect(result.success).toBe(true);
      expect(result.name).toBe('New Name');
      const written = files.write.mock.calls[0][0].content as string;
      expect(written).toContain('name: New Name');
      expect(written).toContain('My desc');
      expect(written).toContain('Original body.');
    });

    it('updates body while preserving name', async function updateBody() {
      const files = makeFiles();
      files.readText.mockResolvedValue(makeJobContent('Keep Name', undefined, 'Old body.'));
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await updateTool.execute({ uuid: VALID_UUID, body: 'New body.' }, context);

      expect(result.success).toBe(true);
      expect(result.name).toBe('Keep Name');
      const written = files.write.mock.calls[0][0].content as string;
      expect(written).toContain('name: Keep Name');
      expect(written).toContain('New body.');
    });

    it('clears description when empty string is passed', async function clearDesc() {
      const files = makeFiles();
      files.readText.mockResolvedValue(makeJobContent('Name', 'Remove me', 'Body.'));
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await updateTool.execute({ uuid: VALID_UUID, description: '' }, context);

      const written = files.write.mock.calls[0][0].content as string;
      expect(written).not.toContain('Remove me');
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  describe('#delete', () => {
    it('throws when appId is missing', async function missingAppId() {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      await expect(deleteTool.execute({ uuid: VALID_UUID }, {})).rejects.toThrow('App ID required');
    });

    it('throws and does NOT tombstone when index is corrupt', async function corruptIndexNoOrphan() {
      const files = makeFiles();
      files.readText.mockResolvedValue('NOT JSON');
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      await expect(deleteTool.execute({ uuid: VALID_UUID }, context)).rejects.toThrow('corrupt');

      // write should NOT have been called (no tombstone, no index update)
      expect(files.write).not.toHaveBeenCalled();
    });

    it('tombstones file and removes UUID from index on successful delete', async function normalDelete() {
      const uuid2 = 'b2c3d4e5-0000-4000-8000-000000000002';
      const files = makeFiles();
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === '.airo/jobs/index.json') return JSON.stringify([VALID_UUID, uuid2]);
        return makeJobContent('My Automation');
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await deleteTool.execute({ uuid: VALID_UUID }, context);

      expect(result.success).toBe(true);
      expect(result.name).toBe('My Automation');

      // Tombstone
      expect(files.write).toHaveBeenCalledWith(
        expect.objectContaining({ path: `.airo/jobs/${VALID_UUID}/${VALID_UUID}.md`, content: '' }),
      );
      // Updated index (only uuid2 remains)
      expect(files.write).toHaveBeenCalledWith(
        expect.objectContaining({ path: '.airo/jobs/index.json', content: JSON.stringify([uuid2]) }),
      );
    });

    it('uses UUID as name when file is not readable', async function unreadableName() {
      const files = makeFiles();
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === '.airo/jobs/index.json') return JSON.stringify([VALID_UUID]);
        throw notFound();
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await deleteTool.execute({ uuid: VALID_UUID }, context);

      expect(result.success).toBe(true);
      expect(result.name).toBe(VALID_UUID);
    });
  });

  // ---------------------------------------------------------------------------
  // getHistory
  // ---------------------------------------------------------------------------

  describe('#getHistory', () => {
    it('returns empty runs when runs directory does not exist (first-run case)', async function noRunsDir() {
      const files = makeFiles();
      files.tree = vi.fn().mockRejectedValue(notFound());
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await getHistoryTool.execute({ uuid: VALID_UUID }, context);

      expect(result.success).toBe(true);
      expect(result.runs).toEqual([]);
      expect(result.message).toContain('No runs');
    });

    it('returns empty runs when runs directory is empty', async function emptyRunsDir() {
      const files = makeFiles();
      files.tree = vi.fn().mockResolvedValue({ entries: [] });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await getHistoryTool.execute({ uuid: VALID_UUID }, context);

      expect(result.success).toBe(true);
      expect(result.runs).toEqual([]);
    });

    it('returns runs sorted newest-first', async function sortedRuns() {
      const files = makeFiles();
      files.tree = vi.fn().mockResolvedValue({
        entries: [
          { path: 'run-a.md', kind: 'file', size: 100, modifiedAt: '2024-01-01T00:00:00Z' },
          { path: 'run-b.md', kind: 'file', size: 100, modifiedAt: '2024-06-01T00:00:00Z' },
        ],
      });
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === 'run-a.md') return '---\nstatus: success\ntimestamp: 2024-01-01\n---\nOld run.';
        return '---\nstatus: success\ntimestamp: 2024-06-01\n---\nNew run.';
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await getHistoryTool.execute({ uuid: VALID_UUID }, context);

      expect(result.runs).toHaveLength(2);
      expect(result.runs[0].summary).toBe('New run.');
      expect(result.runs[1].summary).toBe('Old run.');
    });

    it('respects limit and sets truncated flag', async function limitRuns() {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        path: `run-${i}.md`,
        kind: 'file' as const,
        size: 100,
        modifiedAt: `2024-0${i + 1}-01T00:00:00Z`,
      }));
      const files = makeFiles();
      files.tree = vi.fn().mockResolvedValue({ entries });
      files.readText.mockResolvedValue('---\nstatus: success\n---\nSummary.');
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await getHistoryTool.execute({ uuid: VALID_UUID, limit: 2 }, context);

      expect(result.runs).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.truncated).toBe(true);
      expect(result.showing).toBe(2);
    });

    it('skips missing run files (not-found) and continues', async function missingRunFile() {
      const files = makeFiles();
      files.tree = vi.fn().mockResolvedValue({
        entries: [
          { path: 'run-a.md', kind: 'file', size: 100, modifiedAt: '2024-01-01T00:00:00Z' },
          { path: 'run-b.md', kind: 'file', size: 100, modifiedAt: '2024-06-01T00:00:00Z' },
        ],
      });
      files.readText.mockImplementation(async function readImpl({ path }: { path: string }) {
        if (path === 'run-a.md') throw notFound();
        return '---\nstatus: done\n---\nGood run.';
      });
      mockCreateForWorkspace.mockReturnValue(makeWorkspace(files) as any);

      const result = await getHistoryTool.execute({ uuid: VALID_UUID }, context);

      expect(result.runs).toHaveLength(1);
      expect(result.runs[0].summary).toBe('Good run.');
    });
  });
});
