import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';
import { GitUtils } from '../../utils/git.js';
import { WorkspaceUnavailableError } from '../../workspace/index.js';
import { createMockWorkspaceFiles, type MockWorkspaceFiles } from '../../workspace/__tests__/mock-helpers.js';
import { DevSupervisorError } from '../DevSupervisorClient.js';
import { FormatOverrideService } from '../FormatOverrideService.js';

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
  const appPath = '/workspace/app1234567';
  const expressionHash = `sha256:${'a'.repeat(64)}`;
  const indexSidecarPath = 'format-overrides/pages/index.json';
  const homeSidecarPath = 'format-overrides/pages/home.json';
  const sharedSidecarPath = 'format-overrides/shared.json';

  let store: Map<string, string>;
  let mock: MockWorkspaceFiles;
  let files: MockWorkspaceFiles['spies'];
  let workspaceFactory: ReturnType<typeof vi.fn>;
  let service: FormatOverrideService;
  let appRepository: Pick<AppRepository, 'findById'>;

  function readStoredSidecar(path: string): Record<string, unknown> {
    const content: string | undefined = store.get(path);
    if (content === undefined) throw new Error(`expected sidecar at ${path}`);
    return JSON.parse(content) as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(GitUtils).mockClear();

    mock = createMockWorkspaceFiles();
    store = mock.store;
    files = mock.spies;
    workspaceFactory = vi.fn(() => ({ files: mock.files, tasks: {} }));
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
    service = new FormatOverrideService({
      appRepository,
      workspaceFactory: workspaceFactory as unknown as CreateForWorkspace,
    });
  });

  it('writes a sanitized stable page sidecar entry with the exact write payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));

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

    expect(result).toEqual({ success: true, commitHash: 'commit-123' });

    const expectedContent = `${JSON.stringify(
      {
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
            updatedAt: '2026-05-28T12:00:00.000Z',
          },
        },
        version: 1,
      },
      null,
      2,
    )}\n`;

    expect(files.write).toHaveBeenCalledTimes(1);
    expect(files.write).toHaveBeenCalledWith({ path: indexSidecarPath, content: expectedContent });
    expect(workspaceFactory).toHaveBeenCalledWith(appId, 'preview');
    expect(files.delete).not.toHaveBeenCalled();
  });

  it('round-trips a stored sidecar through view and preserves unrelated entries', async () => {
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

    const sidecar = readStoredSidecar(indexSidecarPath) as {
      overrides: Record<string, { marks: unknown }>;
    };
    expect(sidecar.overrides.c4d5e6.marks).toEqual({ bold: false, color: '#123456', italic: false });
    expect(sidecar.overrides.d5e6f7.marks).toEqual({ bold: false, color: null, italic: true });
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

    const sidecar = readStoredSidecar(sharedSidecarPath) as {
      overrides: Record<string, { target: { file: string }; marks: unknown }>;
    };
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

    const indexSidecar = readStoredSidecar(indexSidecarPath) as {
      overrides: Record<string, { target: { file: string } }>;
    };
    const homeSidecar = readStoredSidecar(homeSidecarPath) as {
      overrides: Record<string, { target: { file: string } }>;
    };

    expect(indexSidecar.overrides.a2b3c4.target.file).toBe('src/pages/index.tsx');
    expect(homeSidecar.overrides.b3c4d5.target.file).toBe('src/pages/home.tsx');
    expect(indexSidecar.overrides.b3c4d5).toBeUndefined();
    expect(homeSidecar.overrides.a2b3c4).toBeUndefined();
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

    expect(result).toEqual({ success: true, removed: true, commitHash: 'commit-123' });
    expect(files.delete).toHaveBeenCalledWith({ path: indexSidecarPath });
    expect(store.has(indexSidecarPath)).toBe(false);
  });

  it('swallows a not-found from delete but propagates other delete errors', async () => {
    store.set(indexSidecarPath, JSON.stringify({
      version: 1,
      overrides: {
        abc123: {
          target: {
            contentKey: null,
            contentKeyTemplate: null,
            expressionHash,
            file: 'src/pages/index.tsx',
            sourceKind: 'bound-expression',
            tagName: 'h1',
          },
          marks: { bold: true, color: null, italic: false },
          updatedAt: '2026-05-28T12:00:00.000Z',
        },
      },
    }));
    files.delete.mockRejectedValueOnce(
      new DevSupervisorError('not_found', 404, `${indexSidecarPath}: no such file`),
    );

    const removeRequest = {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: false, italic: false, color: null },
    } as const;

    await expect(service.update(appId, removeRequest)).resolves.toEqual({
      success: true,
      removed: true,
      commitHash: 'commit-123',
    });

    files.delete.mockRejectedValueOnce(
      new DevSupervisorError('permission_denied', 403, `${indexSidecarPath}: permission denied`),
    );

    await expect(service.update(appId, removeRequest)).rejects.toThrow('permission denied');
  });

  it('stages and commits the scoped sidecar deletion', async () => {
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
    expect(gitUtils?.addFiles).toHaveBeenCalledWith(appPath, [indexSidecarPath]);
    expect(gitUtils?.commitFiles).toHaveBeenCalledWith(appPath, 'Update format overrides', [indexSidecarPath]);
    expect(gitUtils?.commit).not.toHaveBeenCalled();
  });

  it('returns the current HEAD commit after creating a scoped sidecar commit', async () => {
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

  it('throws WorkspaceUnavailableError when the workspace cannot be resolved', async () => {
    workspaceFactory.mockReturnValue(null);

    await expect(service.update(appId, {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash,
      },
      marks: { bold: true },
    })).rejects.toBeInstanceOf(WorkspaceUnavailableError);
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
    const unsupportedSidecar = JSON.stringify({
      version: 2,
      overrides: { stale: { marks: { bold: true } } },
    });
    store.set(indexSidecarPath, unsupportedSidecar);

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

    expect(store.get(indexSidecarPath)).toBe(unsupportedSidecar);
    expect(files.write).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON sidecars without overwriting them', async () => {
    const malformedSidecar = '{not json';
    store.set(indexSidecarPath, malformedSidecar);

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

    expect(store.get(indexSidecarPath)).toBe(malformedSidecar);
    expect(files.write).not.toHaveBeenCalled();
  });

  it('rejects v1 sidecars with malformed entries without overwriting them', async () => {
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
    store.set(indexSidecarPath, malformedEntrySidecar);

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

    expect(store.get(indexSidecarPath)).toBe(malformedEntrySidecar);
    expect(files.write).not.toHaveBeenCalled();
  });

  it('propagates non-not_found transport failures from readText', async () => {
    files.readText.mockRejectedValueOnce(
      new DevSupervisorError('permission_denied', 403, `${indexSidecarPath}: permission denied`),
    );

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
    const firstSidecar = store.get(indexSidecarPath);
    const writeCallsAfterFirst = files.write.mock.calls.length;
    const gitInstanceCountAfterFirst = vi.mocked(GitUtils).mock.results.length;

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

    expect(result).toEqual({ success: true });
    expect(store.get(indexSidecarPath)).toBe(firstSidecar);
    expect(files.write.mock.calls.length).toBe(writeCallsAfterFirst);
    expect(vi.mocked(GitUtils).mock.results).toHaveLength(gitInstanceCountAfterFirst);
  });

  it('logs structured add failures without changing the update response contract', async () => {
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
      relativeFiles: [indexSidecarPath],
      command: failedAddResult.command,
      exitCode: failedAddResult.exitCode,
      stderr: failedAddResult.stderr,
      stdout: failedAddResult.stdout,
      timedOut: failedAddResult.timedOut,
    });
    warn.mockRestore();
  });

  it('logs structured commit failures without changing the update response contract', async () => {
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
      relativeFiles: [indexSidecarPath],
      command: failedCommitResult.command,
      exitCode: failedCommitResult.exitCode,
      stderr: failedCommitResult.stderr,
      stdout: failedCommitResult.stdout,
      timedOut: failedCommitResult.timedOut,
    });
    warn.mockRestore();
  });

  it('serializes concurrent updates to the same sidecar', async () => {
    let shouldDelayFirstWrite = true;
    files.write.mockImplementation(async (options: WriteOptions): Promise<WriteResult> => {
      if (shouldDelayFirstWrite && options.path === indexSidecarPath) {
        shouldDelayFirstWrite = false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      store.set(options.path, options.content);
      return { bytesWritten: options.content.length };
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

    const sidecar = readStoredSidecar(indexSidecarPath) as { overrides: Record<string, unknown> };
    expect(Object.keys(sidecar.overrides).sort()).toEqual(['abc123', 'def456']);
  });

  it('continues same-scope writes after a rejected prior update', async () => {
    files.write.mockRejectedValueOnce(new Error('write failed'));

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

    await expect(firstUpdate).rejects.toThrow('write failed');

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([
        secondUpdate,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('same-scope update did not continue')), 500);
        }),
      ])).resolves.toEqual({ success: true, commitHash: 'commit-123' });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const sidecar = readStoredSidecar(indexSidecarPath) as {
      overrides: Record<string, { marks: unknown }>;
    };
    expect(Object.keys(sidecar.overrides)).toEqual(['def456']);
    expect(sidecar.overrides.def456.marks).toEqual({ bold: false, color: null, italic: true });
  });
});
