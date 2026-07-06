import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js';

const { workspaceView, workspaceReadText, createForWorkspaceMock } = vi.hoisted(() => {
  const workspaceView = vi.fn();
  const workspaceReadText = vi.fn().mockResolvedValue('');
  const createForWorkspaceMock = vi.fn();
  return { workspaceView, workspaceReadText, createForWorkspaceMock };
});

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: createForWorkspaceMock,
}));

import { DiagnoseContextService } from '../DiagnoseContextService.js';
import { redactSecrets } from '../redact-secrets.js';
import type { SanitizedLogEntry } from '../../log-sanitizer.js';

function log(message: string): SanitizedLogEntry {
  return { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message, level: 'error' };
}

describe('redactSecrets', () => {
  it('redacts api keys and bearer tokens', () => {
    const input = 'api_key=sk-secret123 and Bearer eyJhbGciOiJIUzI1NiJ9.x';
    const out = redactSecrets(input);
    expect(out).toContain('api_key=[REDACTED]');
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('sk-secret123');
  });
});

describe('DiagnoseContextService', () => {
  let root: string;
  const service = new DiagnoseContextService();

  beforeEach(async () => {
    workspaceView.mockReset();
    createForWorkspaceMock.mockReset();
    createForWorkspaceMock.mockReturnValue({
      files: createStubWorkspaceFiles({ view: workspaceView, readText: workspaceReadText }),
    });
    root = join(tmpdir(), `diagnose-ctx-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { start: 'node index.js' } }),
      'utf8'
    );
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'app.ts'), 'const x: number = "bad"\n', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prefers snapshot over workspace when snapshot path exists', async () => {
    workspaceView.mockResolvedValue({
      path: 'package.json',
      content: '{"name":"should-not-use"}',
      encoding: 'utf-8',
      lines: 1,
      size: 1,
      truncated: false,
    });

    const result = await service.gather({
      appId: 'app-1',
      target: 'preview',
      logs: [log('error TS2322 in src/app.ts:1:7')],
      snapshotPath: root,
    });

    expect(result.contextSource).toBe('snapshot');
    expect(createForWorkspaceMock).not.toHaveBeenCalled();
  });

  it('reads package.json and log-cited files from snapshot path', async () => {
    const result = await service.gather({
      appId: 'app-1',
      target: 'preview',
      logs: [log('error TS2322 in src/app.ts:1:7')],
      snapshotPath: root,
      logSource: 'import_job',
    });

    expect(result.contextSource).toBe('snapshot');
    expect(result.filesIncluded).toBeGreaterThan(0);
    expect(result.projectContextText).toContain('package.json');
    expect(result.projectContextText).toContain('src/app.ts');
    expect(createForWorkspaceMock).not.toHaveBeenCalled();
  });

  it('extracts paths from logs for targeted reads', () => {
    const paths = new Set<string>();
    service.extractPathsFromLogs([log('Failed at src/lib/util.ts:10:3')], paths);
    expect(paths.has('src/lib/util.ts')).toBe(true);
  });

  it('gatherFromWorkspace reads files when no snapshot is available', async () => {
    workspaceView.mockResolvedValue({
      path: 'package.json',
      content: '{"name":"ws"}',
      encoding: 'utf-8',
      lines: 1,
      size: 10,
      truncated: false,
    });

    const result = await service.gather({
      appId: 'app-ws',
      target: 'preview',
      logs: [log('error in src/foo.ts')],
    });

    expect(createForWorkspaceMock).toHaveBeenCalledWith('app-ws', 'preview');
    expect(result.contextSource).toBe('workspace');
    expect(result.filesIncluded).toBeGreaterThan(0);
    expect(workspaceView).toHaveBeenCalled();
  });
});
