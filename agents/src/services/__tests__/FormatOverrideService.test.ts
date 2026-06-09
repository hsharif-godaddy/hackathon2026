import fs, { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';
import { GitUtils } from '../../utils/git.js';
import { createForWorkspace } from '../../workspace/index.js';
import { FormatOverrideService } from '../FormatOverrideService.js';

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => null),
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function git() {
    return {
      addFiles: vi.fn().mockResolvedValue({ success: true }),
      getStatus: vi.fn().mockResolvedValue({ stagedFiles: 1 }),
      commit: vi.fn().mockResolvedValue({ success: true }),
      commitFiles: vi.fn().mockResolvedValue({ success: true }),
      getCurrentCommit: vi.fn().mockResolvedValue('commit-123'),
      getLastCommit: vi.fn().mockResolvedValue({ hash: 'commit-123' }),
    };
  }),
}));

describe('FormatOverrideService', () => {
  const appId = 'app1234567';
  const expressionHash = `sha256:${'a'.repeat(64)}`;

  let appPath: string;
  let service: FormatOverrideService;
  let appRepository: Pick<AppRepository, 'findById'>;

  const indexSidecarPath = () => join(appPath, 'format-overrides/pages/index.json');
  const homeSidecarPath = () => join(appPath, 'format-overrides/pages/home.json');
  const sharedSidecarPath = () => join(appPath, 'format-overrides/shared.json');

  beforeEach(async () => {
    vi.mocked(createForWorkspace).mockReturnValue(null);
    vi.mocked(GitUtils).mockClear();

    appPath = await mkdtemp(join(tmpdir(), 'format-overrides-app-'));
    appRepository = {
      findById: vi.fn().mockReturnValue({
        id: appId,
        name: 'Format Override Test App',
        path: appPath,
        port: 3000,
        status: 'created',
        publishedUrl: null,
        createdAt: new Date('2026-05-28T00:00:00.000Z'),
        updatedAt: new Date('2026-05-28T00:00:00.000Z'),
      }),
    };
    service = new FormatOverrideService(appRepository);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(appPath, { recursive: true, force: true });
  });

  it('writes a sanitized stable page sidecar entry', async () => {
    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'H1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash,
      },
      marks: { bold: true, italic: false, color: '#ABCDEF' },
    });

    expect(result).toEqual({ success: true });
    const sidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'));
    expect(sidecar).toEqual({
      version: 1,
      overrides: {
        abc123: {
          marks: { bold: true, color: '#abcdef', italic: false },
          target: {
            contentKey: null,
            contentKeyTemplate: null,
            expressionHash,
            file: 'src/pages/index.tsx',
            sourceKind: 'bound-expression',
            tagName: 'h1',
          },
          updatedAt: expect.any(String),
        },
      },
    });
  });

  it('writes sidecars through a same-directory temp file before atomic rename', async () => {
    const originalWriteFile = fs.writeFile.bind(fs);
    const originalRename = fs.rename.bind(fs);
    const writeFile = vi.spyOn(fs, 'writeFile').mockImplementation(originalWriteFile);
    const rename = vi.spyOn(fs, 'rename').mockImplementation(originalRename);

    try {
      await service.update(appId, {
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          expressionHash,
        },
        marks: { bold: true },
      });

      const tempPath = writeFile.mock.calls[0]?.[0]?.toString();
      expect(tempPath).toBeDefined();
      expect(tempPath).not.toBe(indexSidecarPath());
      expect(tempPath).toMatch(/^.+\/format-overrides\/pages\/\.index\.json\..+\.tmp$/);
      expect(rename).toHaveBeenCalledWith(tempPath, indexSidecarPath());
    } finally {
      writeFile.mockRestore();
      rename.mockRestore();
    }
  });

  it('removes the sidecar temp file when the atomic rename fails', async () => {
    const originalWriteFile = fs.writeFile.bind(fs);
    let tempPath = '';
    const writeFile = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      tempPath = args[0].toString();
      return originalWriteFile(...args);
    });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));

    try {
      await expect(service.update(appId, {
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          expressionHash,
        },
        marks: { bold: true },
      })).rejects.toThrow('rename failed');

      expect(tempPath).not.toBe('');
      await expect(readFile(tempPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(indexSidecarPath(), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      writeFile.mockRestore();
      rename.mockRestore();
    }
  });

  it('writes non-page overrides to shared.json', async () => {
    await service.update(appId, {
      devId: 'a1b2c3',
      target: {
        file: 'src/layouts/RootLayout.tsx',
        tagName: 'span',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { italic: true },
    });

    const sidecar = JSON.parse(await readFile(sharedSidecarPath(), 'utf-8'));
    expect(sidecar.overrides.a1b2c3.target.file).toBe('src/layouts/RootLayout.tsx');
    expect(sidecar.overrides.a1b2c3.marks).toEqual({ bold: false, color: null, italic: true });
  });

  it('keeps index and home pages in separate scoped sidecars', async () => {
    await service.update(appId, {
      devId: 'a2b3c4',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });
    await service.update(appId, {
      devId: 'b3c4d5',
      target: {
        file: 'src/pages/home.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { italic: true },
    });

    const indexSidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'));
    const homeSidecar = JSON.parse(await readFile(homeSidecarPath(), 'utf-8'));

    expect(indexSidecar.overrides.a2b3c4.target.file).toBe('src/pages/index.tsx');
    expect(homeSidecar.overrides.b3c4d5.target.file).toBe('src/pages/home.tsx');
    expect(indexSidecar.overrides.b3c4d5).toBeUndefined();
    expect(homeSidecar.overrides.a2b3c4).toBeUndefined();
  });

  it('preserves unrelated entries when updating one override', async () => {
    await service.update(appId, {
      devId: 'c4d5e6',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });

    await service.update(appId, {
      devId: 'd5e6f7',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'p',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'b'.repeat(64)}`,
      },
      marks: { italic: true },
    });

    await service.update(appId, {
      devId: 'c4d5e6',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { color: '#123456' },
    });

    const sidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'));
    expect(sidecar.overrides.c4d5e6.marks).toEqual({ bold: false, color: '#123456', italic: false });
    expect(sidecar.overrides.d5e6f7.marks).toEqual({ bold: false, color: null, italic: true });
  });

  it('removes the sidecar entry and deletes an empty sidecar when marks are default', async () => {
    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: false, italic: false, color: null },
    });

    expect(result).toEqual({ success: true, removed: true });
    await expect(readFile(indexSidecarPath(), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stages and commits the scoped sidecar deletion', async () => {
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as ReturnType<typeof createForWorkspace>);
    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: false, italic: false, color: null },
    });
    const gitUtils = vi.mocked(GitUtils).mock.results.at(-1)?.value;

    expect(result).toEqual({ success: true, removed: true, commitHash: 'commit-123' });
    expect(gitUtils?.addFiles).toHaveBeenCalledWith(appPath, ['format-overrides/pages/index.json']);
    expect(gitUtils?.commitFiles).toHaveBeenCalledWith(
      appPath,
      'Update format overrides',
      ['format-overrides/pages/index.json'],
    );
    expect(gitUtils?.commit).not.toHaveBeenCalled();
  });

  it('returns the current HEAD commit after creating a scoped sidecar commit', async () => {
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as ReturnType<typeof createForWorkspace>);
    const gitUtils = {
      addFiles: vi.fn().mockResolvedValue({ success: true }),
      commit: vi.fn(),
      commitFiles: vi.fn().mockResolvedValue({ success: true }),
      getCurrentCommit: vi.fn().mockResolvedValue('head-commit-456'),
      getLastCommit: vi.fn().mockResolvedValue({ hash: 'main-commit-123' }),
      getStatus: vi.fn(),
    };
    vi.mocked(GitUtils).mockImplementationOnce(function git() {
      return gitUtils as never;
    });

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });

    expect(result).toEqual({ success: true, commitHash: 'head-commit-456' });
    expect(gitUtils.getCurrentCommit).toHaveBeenCalledWith(appPath);
    expect(gitUtils.getLastCommit).not.toHaveBeenCalled();
  });

  it('rejects devIds outside the source-mapper structural id shape', async () => {
    await expect(service.update(appId, {
      devId: '__proto__',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })).rejects.toThrow('devId must be a 6-character hex id');
  });

  it('rejects bound-expression targets without expressionHash', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
      },
      marks: { bold: true },
    })).rejects.toThrow('target.expressionHash is required for bound-expression format overrides');
  });

  it('rejects malformed expressionHash values', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: 'not-a-sha',
      },
      marks: { bold: true },
    })).rejects.toThrow('target.expressionHash must be a sha256 hash');
  });

  it('rejects missing source-kind-specific guard metadata', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'content-key',
      },
      marks: { bold: true },
    })).rejects.toThrow('target.contentKey is required for content-key format overrides');

    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'content-key-template',
      },
      marks: { bold: true },
    })).rejects.toThrow('target.contentKeyTemplate is required for content-key-template format overrides');
  });

  it('rejects invalid colors and unsupported marks', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { color: 'red' },
    })).rejects.toThrow('marks.color must be a 6-digit hex color');

    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true, underline: true } as never,
    })).rejects.toThrow('marks.underline is not supported');
  });

  it('rejects requests with omitted marks', async () => {
    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
    })).rejects.toThrow('marks is required');
  });

  it('rejects unsupported sidecars without overwriting them', async () => {
    await mkdir(join(appPath, 'format-overrides/pages'), { recursive: true });
    const unsupportedSidecar = JSON.stringify({
      version: 2,
      overrides: { stale: { marks: { bold: true } } },
    });
    await writeFile(indexSidecarPath(), unsupportedSidecar);

    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })).rejects.toThrow('Format override sidecar is invalid');

    await expect(readFile(indexSidecarPath(), 'utf-8')).resolves.toBe(unsupportedSidecar);
  });

  it('rejects malformed JSON sidecars without overwriting them', async () => {
    await mkdir(join(appPath, 'format-overrides/pages'), { recursive: true });
    const malformedSidecar = '{not json';
    await writeFile(indexSidecarPath(), malformedSidecar);

    await expect(service.update(appId, {
      devId: 'def456',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'p',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'c'.repeat(64)}`,
      },
      marks: { italic: true },
    })).rejects.toThrow('Format override sidecar is invalid');

    await expect(readFile(indexSidecarPath(), 'utf-8')).resolves.toBe(malformedSidecar);
  });

  it('rejects v1 sidecars with malformed entries without overwriting them', async () => {
    await mkdir(join(appPath, 'format-overrides/pages'), { recursive: true });
    const malformedEntrySidecar = JSON.stringify({
      version: 1,
      overrides: {
        a1b2c3: {
          target: {
            file: 'src/pages/index.tsx',
            tagName: 'h1',
            sourceKind: 'bound-expression',
            expressionHash,
          },
          marks: { bold: true, underline: true },
          updatedAt: '2026-05-28T12:00:00.000Z',
        },
      },
    });
    await writeFile(indexSidecarPath(), malformedEntrySidecar);

    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })).rejects.toThrow('Format override sidecar is invalid');

    await expect(readFile(indexSidecarPath(), 'utf-8')).resolves.toBe(malformedEntrySidecar);
  });

  it('propagates unexpected sidecar read failures', async () => {
    const readError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(readError);

    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })).rejects.toThrow('permission denied');
  });

  it('does not rewrite or commit the sidecar when the normalized entry is unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as ReturnType<typeof createForWorkspace>);

    await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });
    const c4d5e6Sidecar = await readFile(indexSidecarPath(), 'utf-8');
    const c4d5e6GitInstanceCount = vi.mocked(GitUtils).mock.results.length;

    vi.setSystemTime(new Date('2026-05-28T12:01:00.000Z'));
    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });
    const d5e6f7Sidecar = await readFile(indexSidecarPath(), 'utf-8');

    expect(result).toEqual({ success: true });
    expect(d5e6f7Sidecar).toBe(c4d5e6Sidecar);
    expect(vi.mocked(GitUtils).mock.results).toHaveLength(c4d5e6GitInstanceCount);
  });

  it('logs structured add failures without changing the update response contract', async () => {
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as ReturnType<typeof createForWorkspace>);
    const failedAddResult = {
      command: 'git add format-overrides/pages/index.json',
      workingDir: appPath,
      exitCode: 1,
      stdout: '',
      stderr: 'add failed',
      success: false,
      executionTime: 1,
      timedOut: false,
    };
    const gitUtils = {
      addFiles: vi.fn().mockResolvedValue(failedAddResult),
      commit: vi.fn(),
      commitFiles: vi.fn(),
      getCurrentCommit: vi.fn(),
      getLastCommit: vi.fn(),
      getStatus: vi.fn(),
    };
    vi.mocked(GitUtils).mockImplementationOnce(function git() {
      return gitUtils as never;
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });

    expect(result).toEqual({ success: true });
    expect(gitUtils.commitFiles).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('formatOverrides.gitCommit.failed', {
      appId,
      stage: 'add',
      relativeFiles: ['format-overrides/pages/index.json'],
      command: failedAddResult.command,
      exitCode: failedAddResult.exitCode,
      stderr: failedAddResult.stderr,
      stdout: failedAddResult.stdout,
      timedOut: failedAddResult.timedOut,
    });
    warn.mockRestore();
  });

  it('logs structured commit failures without changing the update response contract', async () => {
    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {} } as ReturnType<typeof createForWorkspace>);
    const failedCommitResult = {
      command: 'git commit -m Update format overrides -- format-overrides/pages/index.json',
      workingDir: appPath,
      exitCode: 1,
      stdout: '',
      stderr: 'commit failed',
      success: false,
      executionTime: 1,
      timedOut: false,
    };
    const gitUtils = {
      addFiles: vi.fn().mockResolvedValue({
        command: 'git add format-overrides/pages/index.json',
        workingDir: appPath,
        exitCode: 0,
        stdout: '',
        stderr: '',
        success: true,
        executionTime: 1,
        timedOut: false,
      }),
      commit: vi.fn(),
      commitFiles: vi.fn().mockResolvedValue(failedCommitResult),
      getCurrentCommit: vi.fn(),
      getLastCommit: vi.fn(),
      getStatus: vi.fn(),
    };
    vi.mocked(GitUtils).mockImplementationOnce(function git() {
      return gitUtils as never;
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });

    expect(result).toEqual({ success: true });
    expect(gitUtils.getCurrentCommit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('formatOverrides.gitCommit.failed', {
      appId,
      stage: 'commit',
      relativeFiles: ['format-overrides/pages/index.json'],
      command: failedCommitResult.command,
      exitCode: failedCommitResult.exitCode,
      stderr: failedCommitResult.stderr,
      stdout: failedCommitResult.stdout,
      timedOut: failedCommitResult.timedOut,
    });
    warn.mockRestore();
  });

  it('serializes concurrent updates to the same sidecar', async () => {
    const originalWriteFile = fs.writeFile.bind(fs);
    let shouldDelayFirstSidecarWrite = true;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (shouldDelayFirstSidecarWrite && String(args[0]).endsWith('format-overrides/pages/index.json')) {
        shouldDelayFirstSidecarWrite = false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return originalWriteFile(...args);
    });

    await Promise.all([
      service.update(appId, {
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          expressionHash,
        },
        marks: { bold: true },
      }),
      service.update(appId, {
        devId: 'def456',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'p',
          sourceKind: 'bound-expression',
          expressionHash: `sha256:${'d'.repeat(64)}`,
        },
        marks: { italic: true },
      }),
    ]);

    const sidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'));
    expect(Object.keys(sidecar.overrides).sort()).toEqual(['abc123', 'def456']);
  });

  it('continues same-scope writes after a rejected prior update', async () => {
    const originalRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('rename failed'))
      .mockImplementation(originalRename);

    const firstUpdate = service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    });
    const secondUpdate = service.update(appId, {
      devId: 'def456',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'p',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'d'.repeat(64)}`,
      },
      marks: { italic: true },
    });

    await expect(firstUpdate).rejects.toThrow('rename failed');

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([
        secondUpdate,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('same-scope update did not continue')), 500);
        }),
      ])).resolves.toEqual({ success: true });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const sidecar = JSON.parse(await readFile(indexSidecarPath(), 'utf-8'));
    expect(Object.keys(sidecar.overrides)).toEqual(['def456']);
    expect(sidecar.overrides.def456.marks).toEqual({ bold: false, color: null, italic: true });
  });
});
