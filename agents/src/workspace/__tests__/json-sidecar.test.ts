import { describe, it, expect, vi } from 'vitest';

import { readJsonSidecar } from '../json-sidecar.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import type { WorkspaceFiles } from '../files.js';
import type { ViewResult } from '../files.js';

function makeFiles(viewImpl: () => Promise<ViewResult>): WorkspaceFiles {
  return { view: vi.fn(viewImpl), readText: vi.fn(async () => (await viewImpl()).content) } as unknown as WorkspaceFiles;
}

function viewReturning(content: string): () => Promise<ViewResult> {
  return async () => ({
    path: 'test.json',
    content,
    encoding: 'utf-8' as const,
    lines: 1,
    size: content.length,
    truncated: false,
  });
}

describe('readJsonSidecar', () => {
  it('parses JSON from workspace file', async () => {
    const files: WorkspaceFiles = makeFiles(viewReturning('{"enabled":true}'));
    const result = await readJsonSidecar<{ enabled: boolean }>({
      files,
      path: 'config.json',
      fallback: { enabled: false },
    });
    expect(result).toEqual({ enabled: true });
  });

  it('returns fallback when file not found (DevSupervisorError not_found)', async () => {
    const files: WorkspaceFiles = makeFiles(async () => {
      throw new DevSupervisorError('not_found', 404, 'config.json: no such file');
    });
    const result = await readJsonSidecar<string>({
      files,
      path: 'config.json',
      fallback: 'default',
    });
    expect(result).toBe('default');
  });

  it('returns fallback on SyntaxError when no onMalformed provided', async () => {
    const files: WorkspaceFiles = makeFiles(viewReturning('not valid json'));
    const result = await readJsonSidecar<string>({
      files,
      path: 'config.json',
      fallback: 'default',
    });
    expect(result).toBe('default');
  });

  it('calls onMalformed on SyntaxError and returns its result', async () => {
    const files: WorkspaceFiles = makeFiles(viewReturning('{broken'));
    const onMalformed = vi.fn((_error: SyntaxError) => 'recovered');
    const result = await readJsonSidecar<string>({
      files,
      path: 'config.json',
      fallback: 'default',
      onMalformed,
    });
    expect(result).toBe('recovered');
    expect(onMalformed).toHaveBeenCalledOnce();
    expect(onMalformed.mock.calls[0][0]).toBeInstanceOf(SyntaxError);
  });

  it('allows onMalformed to throw', async () => {
    const files: WorkspaceFiles = makeFiles(viewReturning('{broken'));
    const onMalformed = (_error: SyntaxError): never => {
      throw new Error('malformed sidecar');
    };
    await expect(
      readJsonSidecar<string>({ files, path: 'config.json', fallback: 'default', onMalformed }),
    ).rejects.toThrow('malformed sidecar');
  });

  it('uses validate callback and returns validated value', async () => {
    const files: WorkspaceFiles = makeFiles(viewReturning('{"v":1,"data":"hello"}'));
    const validate = (parsed: unknown): string | null => {
      const obj = parsed as { v: number; data: string };
      return obj.v === 1 ? obj.data : null;
    };
    const result = await readJsonSidecar<string>({
      files,
      path: 'config.json',
      fallback: 'none',
      validate,
    });
    expect(result).toBe('hello');
  });

  it('returns fallback when validate returns null', async () => {
    const files: WorkspaceFiles = makeFiles(viewReturning('{"v":2}'));
    const validate = (_parsed: unknown): string | null => null;
    const result = await readJsonSidecar<string>({
      files,
      path: 'config.json',
      fallback: 'none',
      validate,
    });
    expect(result).toBe('none');
  });

  it('re-throws non-DevSupervisor, non-SyntaxError errors', async () => {
    const files: WorkspaceFiles = makeFiles(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      readJsonSidecar<string>({ files, path: 'config.json', fallback: 'default' }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('re-throws DevSupervisorError with non-not_found code', async () => {
    const files: WorkspaceFiles = makeFiles(async () => {
      throw new DevSupervisorError('permission_denied', 403, 'access denied');
    });
    await expect(
      readJsonSidecar<string>({ files, path: 'config.json', fallback: 'default' }),
    ).rejects.toThrow('access denied');
  });
});
