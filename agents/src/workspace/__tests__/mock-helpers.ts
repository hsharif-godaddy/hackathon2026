/**
 * Test helpers for workspace-related mocks.
 *
 * Provides factory functions for creating RunCommandResult objects with
 * sensible defaults, reducing boilerplate in unit tests.
 */

import { vi } from 'vitest';

import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import type { DeleteOptions, ViewOptions, ViewResult, WorkspaceFiles, WriteOptions, WriteResult } from '../files.js';
import type { RunCommandResult } from '../tasks.js';

/**
 * Create a RunCommandResult with defaults for a successful command.
 * Override any field via the partial parameter.
 *
 * @example
 * // Successful result (all defaults)
 * makeRunCommandResult()
 *
 * // Failed result with stderr
 * makeRunCommandResult({ exitCode: 1, stderr: 'not found' })
 *
 * // Timed-out result
 * makeRunCommandResult({ exitCode: -1, timedOut: true, executionTimeMs: 30_000 })
 */
export function makeRunCommandResult(overrides: Partial<RunCommandResult> = {}): RunCommandResult {
  return {
    taskId: 't',
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    executionTimeMs: 1,
    ...overrides,
  };
}

export interface MockWorkspaceFiles {
  store: Map<string, string>;
  files: Pick<WorkspaceFiles, 'view' | 'write' | 'delete'>;
  spies: {
    view: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

export function createMockWorkspaceFiles(seed: Record<string, string> = {}): MockWorkspaceFiles {
  const store: Map<string, string> = new Map(Object.entries(seed));

  const view = vi.fn(async (options: ViewOptions): Promise<ViewResult> => {
    const content: string | undefined = store.get(options.path);
    if (content === undefined) {
      throw new DevSupervisorError('not_found', 404, `${options.path}: no such file`);
    }
    return {
      path: options.path,
      content,
      encoding: 'utf-8',
      lines: content.split('\n').length,
      size: Buffer.byteLength(content),
      truncated: false,
    };
  });

  const write = vi.fn(async (options: WriteOptions): Promise<WriteResult> => {
    store.set(options.path, options.content);
    return { bytesWritten: Buffer.byteLength(options.content) };
  });

  const del = vi.fn(async (options: DeleteOptions): Promise<void> => {
    store.delete(options.path);
  });

  return {
    store,
    files: { view, write, delete: del } as Pick<WorkspaceFiles, 'view' | 'write' | 'delete'>,
    spies: { view, write, delete: del },
  };
}
