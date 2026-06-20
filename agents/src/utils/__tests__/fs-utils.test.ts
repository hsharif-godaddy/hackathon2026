import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs before importing the module under test so the module binds
// to the mock at import time.
vi.mock('node:fs', () => {
  const writeFile = vi.fn();
  const rename = vi.fn();
  const rm = vi.fn();
  const access = vi.fn();
  return {
    promises: { writeFile, rename, rm, access },
  };
});

import { promises as fs } from 'node:fs';
import { atomicWrite, fileExists } from '../fs-utils.js';

const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedRename = vi.mocked(fs.rename);
const mockedRm = vi.mocked(fs.rm);
const mockedAccess = vi.mocked(fs.access);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('atomicWrite', () => {
  it('writes to a tmp file and renames it on success', async () => {
    mockedWriteFile.mockResolvedValueOnce(undefined as any);
    mockedRename.mockResolvedValueOnce(undefined as any);

    await atomicWrite('/some/file.json', 'content');

    expect(mockedWriteFile).toHaveBeenCalledOnce();
    const [tmpPath, contents, encoding] = mockedWriteFile.mock.calls[0]!;
    expect(tmpPath).toMatch(/\/some\/file\.json\.\d+\.\d+\.[a-z0-9]+\.tmp$/);
    expect(contents).toBe('content');
    expect(encoding).toBe('utf8');

    expect(mockedRename).toHaveBeenCalledWith(tmpPath, '/some/file.json');
    // No cleanup on success
    expect(mockedRm).not.toHaveBeenCalled();
  });

  it('cleans up the tmp file and rethrows when rename fails', async () => {
    const renameError = new Error('ENOSPC: no space left');
    mockedWriteFile.mockResolvedValueOnce(undefined as any);
    mockedRename.mockRejectedValueOnce(renameError);
    mockedRm.mockResolvedValueOnce(undefined as any);

    await expect(atomicWrite('/some/file.json', 'content')).rejects.toThrow(renameError);

    const [tmpPath] = mockedWriteFile.mock.calls[0]!;
    expect(mockedRm).toHaveBeenCalledWith(tmpPath, { force: true });
  });

  it('rethrows the rename error even when rm itself fails (best-effort cleanup)', async () => {
    const renameError = new Error('rename failed');
    mockedWriteFile.mockResolvedValueOnce(undefined as any);
    mockedRename.mockRejectedValueOnce(renameError);
    mockedRm.mockRejectedValueOnce(new Error('rm also failed'));

    await expect(atomicWrite('/some/file.json', 'content')).rejects.toThrow(renameError);
  });
});

describe('fileExists', () => {
  it('returns true when fs.access resolves', async () => {
    mockedAccess.mockResolvedValueOnce(undefined as any);
    expect(await fileExists('/some/file.json')).toBe(true);
  });

  it('returns false when fs.access rejects with ENOENT', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedAccess.mockRejectedValueOnce(err);
    expect(await fileExists('/some/file.json')).toBe(false);
  });

  it('rethrows when fs.access rejects with a non-ENOENT code (e.g. EACCES)', async () => {
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    mockedAccess.mockRejectedValueOnce(err);
    await expect(fileExists('/some/file.json')).rejects.toThrow('EACCES');
  });
});
