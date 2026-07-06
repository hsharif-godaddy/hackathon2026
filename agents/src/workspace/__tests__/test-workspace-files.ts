/**
 * Shared WorkspaceFiles test double — the single source of truth for mocking
 * the WorkspaceFiles interface in unit tests. When a method is added to
 * WorkspaceFiles, update ONLY this file; all consumers inherit the change.
 */

import { vi } from 'vitest';

import type { WorkspaceFiles } from '../files.js';

type WorkspaceFilesOverrides = { [K in keyof WorkspaceFiles]?: WorkspaceFiles[K] | ReturnType<typeof vi.fn> };

/**
 * Create a WorkspaceFiles object with all methods stubbed as vi.fn().
 * Pass overrides to pre-configure specific methods (e.g. with mockResolvedValue).
 *
 * @example
 * // Bare stubs (all methods are vi.fn())
 * const files = createStubWorkspaceFiles();
 *
 * // Pre-configured view method
 * const mockView = vi.fn().mockResolvedValue({ path: 'x', content: '', lines: 0, size: 0, truncated: false });
 * const files = createStubWorkspaceFiles({ view: mockView });
 */
export function createStubWorkspaceFiles(overrides?: WorkspaceFilesOverrides): WorkspaceFiles {
  return {
    tree: vi.fn(),
    stat: vi.fn(),
    view: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn(),
    readText: vi.fn(),
    download: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceFiles;
}
