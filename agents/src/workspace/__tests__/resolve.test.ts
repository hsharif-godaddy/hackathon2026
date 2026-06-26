import { describe, it, expect, vi } from 'vitest';

import { resolveWorkspace, resolveWorkspaceFiles } from '../resolve.js';
import { WorkspaceUnavailableError } from '../errors.js';
import type { CreateForWorkspace, WorkspaceClient } from '../client.js';
import type { WorkspaceFiles } from '../files.js';

const fakeFiles: WorkspaceFiles = {} as WorkspaceFiles;

const fakeClient: WorkspaceClient = {
  workspaceId: 'app123',
  variant: 'preview',
  files: fakeFiles,
} as unknown as WorkspaceClient;

describe('resolveWorkspace', () => {
  it('returns workspace when factory returns non-null', () => {
    const factory: CreateForWorkspace = vi.fn(() => fakeClient);
    const result: WorkspaceClient = resolveWorkspace('app123', 'preview', factory);
    expect(result).toBe(fakeClient);
    expect(factory).toHaveBeenCalledWith('app123', 'preview');
  });

  it('throws WorkspaceUnavailableError when factory returns null', () => {
    const factory: CreateForWorkspace = vi.fn(() => null);
    expect(() => resolveWorkspace('app123', 'preview', factory)).toThrow(WorkspaceUnavailableError);
  });

  it('propagates error details in thrown WorkspaceUnavailableError', () => {
    const factory: CreateForWorkspace = vi.fn(() => null);
    try {
      resolveWorkspace('app-xyz', 'publish', factory);
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceUnavailableError);
      const wsError = error as WorkspaceUnavailableError;
      expect(wsError.workspaceId).toBe('app-xyz');
      expect(wsError.variant).toBe('publish');
    }
  });
});

describe('resolveWorkspaceFiles', () => {
  it('returns workspace.files when factory returns non-null', () => {
    const factory: CreateForWorkspace = vi.fn(() => fakeClient);
    const result: WorkspaceFiles = resolveWorkspaceFiles('app123', 'preview', factory);
    expect(result).toBe(fakeFiles);
  });

  it('throws WorkspaceUnavailableError when factory returns null', () => {
    const factory: CreateForWorkspace = vi.fn(() => null);
    expect(() => resolveWorkspaceFiles('app123', 'preview', factory)).toThrow(WorkspaceUnavailableError);
  });
});
